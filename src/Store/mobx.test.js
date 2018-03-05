const {
  observable,
  intercept,
  extendObservable,
  useStrict,
  isObservableArray
} = require("mobx");
const Gun = require("gun/gun");

useStrict(true);

const META_KEY = "_gunObservable";

const isGunObservable = obj => typeof obj === "object" && !!obj[META_KEY];
const getMeta = obj => (isGunObservable(obj) && obj[META_KEY]) || null;

const getSoul = gun => gun._.soul;
const getRoot = gun => gun._.root;
const throwError = message => {
  throw new Error(message);
};

const isGunPrimitive = value =>
  value == null ||
  typeof value === "boolean" ||
  typeof value === "number" ||
  typeof value === "string";
const isGunRef = value =>
  !!(
    value != null &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    value["#"]
  );

const gunObservableCache = {};
const gunObservable = (gun, source = {}) => {
  const soul = getSoul(gun);
  if (soul == null) {
    throwError("root gun object is not allowed");
  }

  if (gunObservableCache[soul]) {
    const object = gunObservableCache[soul];
    getMeta(object).addReference();
    return object;
  }

  const value = isGunRef(source) ? {} : source || {};
  // write the object to gun, empty object is a no-op, null is clear
  gun.put(value);

  // keep the non object
  const object = observable.shallowObject(value);
  let referenceCount = 1;
  extendObservable(object, {
    get [META_KEY]() {
      return {
        gun,
        addReference() {
          referenceCount++;
        },
        removeReference() {
          referenceCount--;
          if (referenceCount === 0) {
            gun.off();
          } else if (referenceCount < 0) {
            throwError("reference count leak");
          }
        }
      };
    },
    get set() {
      return (key, value) => extendObservable(object, { [key]: value });
    }
  });

  const lastValues = {};

  intercept(object, change => {
    const { object, type, name } = change;
    const oldValue = object[name];
    let { newValue } = change;

    console.log(type);
    console.log(name);
    console.log(newValue);

    if (Array.isArray(newValue) || isObservableArray(newValue)) {
      throwError("setting arrays is not allowed");
    }

    if (name != "_" && (type === "update" || type === "add")) {
      // update reference counting
      if (isGunObservable(oldValue)) {
        getMeta(oldValue).removeReference();
      }

      // JSON.stringify(oldValue) //?
      // JSON.stringify(newValue) //?
      // console.log(isGunRef(oldValue)) //?

      if (isGunPrimitive(oldValue) && !isGunPrimitive(newValue)) {
        delete lastValues[name];
        newValue = gunObservable(gun.get(name), newValue);
      } else if (isGunRef(newValue)) {
        // link the observable
        newValue = gunObservable(getRoot(gun).get(newValue["#"])); //?
      } else if (lastValues[name] !== newValue) {
        lastValues[name] = newValue;
        gun.put({ [name]: newValue });
      }

      return { object, type, name, newValue };
    } else {
      return change;
    }
  });

  gun.on(
    change => {
      Object.keys(change).forEach(name => {
        const value = change[name];
        if (name !== "_" && !isGunPrimitive(value)) {
          delete lastValues[name];
          extendObservable(object, { [name]: value });
        } else if (lastValues[name] !== value) {
          lastValues[name] = value;
          extendObservable(object, { [name]: value });
        }
      });
    },
    { change: true }
  );

  gunObservableCache[soul] = object;
  return object;
};

it("can overwrite properties", async () => {
  // const gun = Gun({ localStorage: false });
  const gun = Gun({ file: "test.json" });

  let gunDoc,
    doc = gunObservable(gun.get("data"), { key: "value" });

  expect(doc.key).toEqual("value");
  gunDoc = await new Promise(resolve => gun.get("data").val(resolve));
  expect(gunDoc.key).toEqual("value");

  doc.key = "value2";
  expect(doc.key).toEqual("value2");
  gunDoc = await new Promise(resolve => gun.get("data").val(resolve));
  expect(gunDoc.key).toEqual("value2");
});

it("can add properties", async () => {
  // const gun = Gun({ localStorage: false });
  const gun = Gun({ file: "test.json" });

  let gunDoc,
    doc = gunObservable(gun.get("data2"), { key: "value" });

  expect(doc.key).toEqual("value");
  gunDoc = await new Promise(resolve => gun.get("data2").val(resolve));
  expect(gunDoc.key).toEqual("value");

  doc.set("key2", "value2");

  expect(doc.key2).toEqual("value2");
  gunDoc = await new Promise(resolve => gun.get("data2").val(resolve));
  expect(gunDoc.key2).toEqual("value2");
});

it("returns duplicates as same object", async () => {
  // const gun = Gun({ localStorage: false });
  const gun = Gun({ file: "test.json" });

  const doc1 = gunObservable(gun.get("data3"), { key: "value" });
  const doc2 = gunObservable(gun.get("data3"), { key: "value" });

  expect(doc1).toEqual(doc2);
});

it("creates new objects when setting objects", async () => {
  // const gun = Gun({ localStorage: false });
  const gun = Gun({ file: "test.json" });

  let gunDoc,
    doc = gunObservable(gun.get("data4"), { key: { sub: "value" } });

  expect(doc.key.sub).toEqual("value");
  gunDoc = await new Promise(resolve =>
    gun
      .get("data4")
      .get("key")
      .val(resolve)
  );
  expect(gunDoc.sub).toEqual("value");
});
