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
const onlyGunPrimitives = object =>
  Object.keys(source)
    .filter(isGunPrimitive)
    .reduce((object, key) => ((object[key] = source[key]), object), {});
const onlyGunNonPrimitives = object =>
  Object.keys(source)
    .filter(val => !isGunPrimitive(val))
    .reduce((object, key) => ((object[key] = source[key]), object), {});

const gunObservable = (gun, source = {}) => {
  const soul = getSoul(gun);
  if (soul == null) {
    throwError("root gun object is not allowed");
  }

  gunObservable.cache = gunObservable.cache || {};
  if (gunObservable.cache[soul]) return gunObservable.cache[soul];

  const value = isGunRef(source) ? {} : source || {};
  // write the object to gun, empty object is a no-op, null is clear
  gun.put(value);

  // keep the non object
  const object = observable(value);
  extendObservable(object, {
    get [META_KEY]() {
      return { gun };
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
      if (isGunPrimitive(oldValue) && !isGunPrimitive(newValue)) {
        delete lastValues[name];
        newValue = gunObservable(gun.get(name), newValue);
      } else if (
        false &&
        isGunObservable(oldValue) &&
        isGunPrimitive(newValue)
      ) {
        // FIXME should we stop listeners? Maybe the solution is reference counting
        getMeta(oldValue).gun.off(); // stop the listener
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

  gunObservable.cache[soul] = object;
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
