const {
  addDisposer,
  types,
  resolveIdentifier,
  getRoot,
  flow,
  getEnv,
  getSnapshot,
  applySnapshot,
  onSnapshot,
  getType
} = require("mobx-state-tree");
const { whenAsync } = require("mobx-utils");
const { extendObservable, when } = require("mobx");

const typeToMapName = type =>
  type.name[0].toLowerCase() + type.name.substr(1) + "s";

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

const ModelFactory = (name, processGunChange) =>
  BaseModel.props({
    typeName: types.optional(types.literal(name), name)
  })
    .named(name)
    .volatile(self => ({
      _status: "loaded"
    }))
    .views(self => ({
      get whenLoaded() {
        return Promise.resolve(self);
      }
    }))
    .actions(self => {
      let handler;
      return {
        processGunChange:
          processGunChange ||
          (snapshot => {
            applySnapshot(self, snapshot);
          }),
        afterAttach() {
          if (handler) {
            handler.off();
          }
          handler = self.gun.on(
            value => setTimeout(() => self.processGunChange(value), 0),
            { change: true }
          );
          addDisposer(
            self,
            onSnapshot(self, snapshot => {
              console.log(snapshot);
              // self.gun && self.gun.put(snapshot);
            })
          );
        },
        beforeDestroy() {
          if (handler) {
            handler.off();
          }
        }
      };
    });

const RequestFactory = allTypes =>
  BaseModel.named("Request")
    .props({
      typeName: types.optional(types.literal("Request"), "Request"),
      type: types.frozen
    })
    .actions(() => ({
      postProcessSnapshot: snapshot => ({ ...snapshot, type: undefined })
    }))
    .volatile(self => ({
      _status: "requested"
    }))
    .extend(self => {
      let handler,
        resolveWhenLoaded = () => {};
      return {
        views: {
          get whenLoaded() {
            return new Promise(resolve => (resolveWhenLoaded = resolve));
          }
        },
        actions: {
          afterAttach() {
            self._status = "loading";
            self.cancelHandler();
            handler = self.gun.on(
              value =>
                setTimeout(() => {
                  if (self.type.is(value)) {
                    resolveWhenLoaded(getRoot(self).create(self.type, value));
                    self.cancelHandler();
                  }
                }, 0),
              { change: true }
            );
          },
          cancelHandler() {
            if (handler) {
              handler.off();
              handler = null;
            }
          },
          beforeDestroy() {
            self.cancelHandler();
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
        props[typeToMapName(type)] = types.optional(types.map(type), {});
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
        create(type, snapshot) {
          if (allTypes.indexOf(type) === -1) {
            throw new Error(`${type.name} is not a known type to this store`);
          }
          const map = self[typeToMapName(type)];
          if (map.has(snapshot.id)) {
            throw new Error(
              `${type.name}:${snapshot.id} already exists in the store`
            );
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
            type: type
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

module.exports = { typeToMapName, ModelFactory, StoreFactory };
