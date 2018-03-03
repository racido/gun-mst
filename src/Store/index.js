const deepSet = require("dset");
const {
  addDisposer,
  types,
  resolveIdentifier,
  getRoot,
  flow,
  getEnv,
  getSnapshot,
  applySnapshot,
  onPatch,
  applyPatch,
  getType,
  hasParent,
  getParent
} = require("mobx-state-tree");
const { whenAsync } = require("mobx-utils");
const { extendObservable, when } = require("mobx");

const typeToSingular = type => type.name[0].toLowerCase() + type.name.substr(1);
const typeToPlural = type => typeToSingular(type) + "s";

const getterFor = type => (identifier, self) =>
  getRoot(self).getOrLoad(
    typeof type === "function" ? type() : type,
    identifier
  );

const baseReference = type =>
  types.maybe(
    types.reference(typeof type === "function" ? type() : type, {
      get: getterFor(type),
      set(node) {
        return node.id;
      }
    })
  );
const reference = type =>
  typeof type === "function"
    ? types.late(`Late ${type.name}`, () => baseReference(type))
    : baseReference(type);

const baseArrayReference = type =>
  types.maybe(
    types.array(
      types.reference(typeof type === "function" ? type() : type, {
        get: getterFor(type),
        set(node) {
          return node.id;
        }
      })
    )
  );
const arrayReference = type =>
  typeof type === "function"
    ? types.late(`Late [${type.name}]`, () => baseArrayReference(type))
    : baseArrayReference(type);

const BaseModel = types
  .model("BaseModel", {
    id: types.identifier(types.string)
  })
  .views(self => {
    return {
      get gun() {
        const gun = getEnv(self).gun;
        return gun && gun.get(self.id);
      },
      get isLoaded() {
        return self._status === "loaded";
      },
      get isLoading() {
        return self._status === "loading";
      }
    };
  });

const ModelFactory = (
  name,
  {
    props = {},
    processGunChange = self => snapshot =>
      applySnapshot(self, { ...getSnapshot(self), ...snapshot }),
    references = {}
  }
) =>
  BaseModel.props({
    typeName: types.optional(types.literal(name), name)
  })
    .named(name)
    .props({
      ...props,
      ...Object.keys(references).reduce((props, key) => {
        props[key] = reference(references[key]);
        return props;
      }, {})
    })
    .volatile(self => ({ _status: "loaded" }))
    .views(self => ({
      get whenLoaded() {
        return Promise.resolve(self);
      }
    }))
    .actions(self => {
      let handler;
      return {
        cancelHandler() {
          if (handler) {
            // console.log("off", self.id, getEnv(self).storeId);
            handler.off();
            handler = null;
          }
        },
        beforeDestroy() {
          self.cancelHandler();
        },
        processGunChange: processGunChange(self),
        afterAttach() {
          self.cancelHandler();
          // console.log("on", self.id, getEnv(self).storeId);
          handler = self.gun.on(
            value => {
              // console.log("on value", value, getEnv(self).storeId);
              const cloned = { ...value };
              delete cloned._;
              self.processGunChange(cloned);
            },
            { change: true }
          );

          addDisposer(
            self,
            onPatch(self, ({ op, path, value }) => {
              const update = {};
              deepSet(
                update,
                path.split("/").slice(1),
                op === "remove" ? null : value
              );
              // console.log("gun put", {
              //   ...update,
              //   s: getEnv(self).storeId
              // });
              self.gun.put(update);
            })
          );
        }
      };
    });

const RequestFactory = allTypes =>
  BaseModel.named("Request")
    .props({
      typeName: types.enumeration("TypeName", allTypes.map(type => type.name))
    })
    .actions(() => ({
      postProcessSnapshot: snapshot => ({ ...snapshot, type: undefined })
    }))
    .volatile(self => ({ _status: "requested" }))
    .extend(self => {
      let handler,
        resolveWhenLoaded = () => {};
      return {
        views: {
          get type() {
            return allTypes.find(type => type.name === self.typeName);
          },
          get whenLoaded() {
            return new Promise(resolve => (resolveWhenLoaded = resolve));
          }
        },
        actions: {
          cancelHandler() {
            if (handler) {
              handler.off();
              handler = null;
            }
          },
          beforeDestroy() {
            self.cancelHandler();
          },
          afterAttach() {
            self._status = "loading";
            self.cancelHandler();
            handler = self.gun.on(value =>
              setTimeout(() => {
                if (self.type.is(value)) {
                  // cancel this handler before it is needed again in the create
                  self.cancelHandler();
                  resolveWhenLoaded(
                    // do not send update to gun
                    // as we've just read it from gun
                    getRoot(self).create(self.type, value, false)
                  );
                }
              }, 0)
            );
          }
        }
      };
    });

const StoreFactory = allTypes => {
  return types
    .model("GunStore", {
      requests: types.optional(types.map(RequestFactory(allTypes)), {}),
      // gunDocs: types.optional(types.map(DocFactory(allTypes)), {}),
      ...allTypes.reduce((props, type) => {
        props[typeToPlural(type)] = types.optional(types.map(type), {});
        return props;
      }, {})
    })
    .views(self => {
      return {
        getOrLoad(type, identifier, requestedFrom = self) {
          const object = self.get(type, identifier);
          return object
            ? object
            : getRoot(self).executeRequest(requestedFrom, type, identifier);
        }
      };
    })
    .actions(self => {
      return {
        get(type, id) {
          return resolveIdentifier(type, self, id);
        },
        create(type, snapshot, updateGun = true) {
          if (allTypes.indexOf(type) === -1) {
            throw new Error(`${type.name} is not a known type to this store`);
          }
          const map = self[typeToPlural(type)];
          if (map.has(snapshot.id)) {
            throw new Error(
              `${type.name}:${snapshot.id} already exists in the store`
            );
          }
          if (updateGun) {
            getEnv(self)
              .gun.get(snapshot.id)
              .put(snapshot);
          }
          map.set(snapshot.id, snapshot);
          return map.get(snapshot.id);
        },
        executeRequest(requestedFrom, type, identifier) {
          if (allTypes.indexOf(type) === -1) {
            throw new Error(`${type.name} is not a known type to this store`);
          }
          self.requests.set(identifier, {
            id: identifier,
            typeName: type.name
          });
          return self.requests.get(identifier);
        },
        notifyInstance(instance) {
          if (!self.gunDocs.has(instance.id)) {
            self.gunDocs.set(instance.id, {
              soul: instance.id,
              instance
            });
          }
        }
      };
    });
};

module.exports = {
  ModelFactory,
  StoreFactory,
  reference,
  arrayReference,
  typeToPlural,
  typeToSingular
};
