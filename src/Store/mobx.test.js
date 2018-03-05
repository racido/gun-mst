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
  // check cache
  const soul = getSoul(gun);
  if (gunObservableCache[soul]) {
    const object = gunObservableCache[soul];
    getMeta(object).addReference();
    return object;
  }

  // write the object to gun, empty object is a no-op, null is clear
  const value = isGunRef(source) ? {} : source;
  gun.put(value);

  // keep the non object
  const object = observable.shallowObject(value);
  extendObservable(object, {
    get [META_KEY]() {
      const meta = {
        referenceCount: 1,
        gun,
        addReference() {
          meta.referenceCount++;
        },
        removeReference() {
          meta.referenceCount--;
          if (meta.referenceCount === 0) {
            gun.off();
          } else if (meta.referenceCount < 0) {
            throwError("reference count leak");
          }
        }
      };
      return meta;
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
      if (oldValue === newValue) {
        return null;
      }

      // update reference counting
      if (isGunObservable(oldValue)) {
        getMeta(oldValue).removeReference();
      }

      console.log(oldValue);
      console.log(newValue);

      if (isGunPrimitive(oldValue) && !isGunPrimitive(newValue)) {
        delete lastValues[name];
        oldValue; //?
        newValue; //?
        name; //?
        getSoul(gun); //?
        newValue = gunObservable(gun.get(name), newValue);
      } else if (isGunRef(newValue)) {
        newValue = gunObservable(getRoot(gun).get(newValue["#"]));
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

  // property access (only works when property already exists)
  doc.key = "value2";
  expect(doc.key).toEqual("value2");
  gunDoc = await new Promise(resolve => gun.get("data").val(resolve));
  expect(gunDoc.key).toEqual("value2");

  // set method
  doc.set("key", "value3");
  expect(doc.key).toEqual("value3");
  gunDoc = await new Promise(resolve => gun.get("data").val(resolve));
  expect(gunDoc.key).toEqual("value3");
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

it("allows overwriting objects with primitives", async () => {
  // const gun = Gun({ localStorage: false });
  const gun = Gun({ file: "test.json" });

  let gunDoc,
    doc = gunObservable(gun.get("data5"), { key: { sub: "value" } });

  expect(doc.key.sub).toEqual("value");
  gunDoc = await new Promise(resolve =>
    gun
      .get("data5")
      .get("key")
      .val(resolve)
  );
  expect(gunDoc.sub).toEqual("value");

  doc.key = "sub";
  expect(doc.key).toEqual("sub");
  gunDoc = await new Promise(resolve =>
    gun
      .get("data5")
      .get("key")
      .val(resolve)
  );
  expect(gunDoc).toEqual("sub");
});

it("allows overwriting objects with null", async () => {
  // const gun = Gun({ localStorage: false });
  const gun = Gun({ file: "test.json" });

  let gunDoc,
    doc = gunObservable(gun.get("data7"), { key: { sub: "value" } });

  expect(doc.key.sub).toEqual("value");
  gunDoc = await new Promise(resolve =>
    gun
      .get("data7")
      .get("key")
      .val(resolve)
  );
  expect(gunDoc.sub).toEqual("value");

  doc.key = null;
  expect(doc.key).toEqual(null);
  gunDoc = await new Promise(resolve =>
    gun
      .get("data7")
      .get("key")
      .val(resolve)
  );
  expect(gunDoc).toEqual(null);
});

it("allows overwriting primitives with objects", async () => {
  // const gun = Gun({ localStorage: false });
  const gun = Gun({ file: "test.json" });

  let gunDoc,
    doc = gunObservable(gun.get("data6"), { key: "wop" });

  expect(doc.key).toEqual("wop");
  gunDoc = await new Promise(resolve =>
    gun
      .get("data6")
      .get("key")
      .val(resolve)
  );
  expect(gunDoc).toEqual("wop");

  doc.key = { wop: "value" };
  expect(doc.key.wop).toEqual("value");
  gunDoc = await new Promise(resolve =>
    gun
      .get("data6")
      .get("key")
      .val(resolve)
  );
  expect(gunDoc.wop).toEqual("value");
});
