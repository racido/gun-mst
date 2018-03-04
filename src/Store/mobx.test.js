const { observable, intercept, extendObservable, useStrict } = require("mobx");
const Gun = require("gun/gun");

useStrict(true);

const META_KEY = "_deepObservable";

const isDeepObservable = obj => typeof obj === "object" && !!obj[META_KEY];
const getMeta = obj => (isDeepObservable(obj) && obj[META_KEY]) || null;

const deepObservable = (source, meta = {}) => {
  let soul;
  if (typeof source === "string") {
    soul = source;
    source = {};
  }

  // apply defaults
  meta = {
    ...{
      parent: null,
      name: null,
      gun: null
    },
    ...meta
  };

  extendObservable(meta, {
    get path() {
      const { parent, name } = meta;
      return parent && name ? getMeta(parent).path.concat(name) : [];
    },
    get _onChange() {
      return (
        meta.onChange ||
        (meta.parent && getMeta(meta.parent)._onChange) ||
        (change => console.log("no onChange handler for", change))
      );
    }
  });

  const obj = observable(source);

  extendObservable(obj, {
    get [META_KEY]() {
      // getters are not enumerated
      return meta;
    }
  });

  intercept(obj, change => {
    const { object, type, name, oldValue = object[name] } = change;
    let { newValue } = change;

    switch (type) {
      case "update":
      case "add":
        if (typeof newValue === "object") {
          const getGunRef = obj =>
            (Object.keys(obj).length === 1 && obj["#"]) || null;
          const refSoul = getGunRef(newValue);
          if (refSoul) {
            newValue = deepObservable(refSoul, { parent: object, name });
          } else if (isDeepObservable(newValue)) {
          } else {
            newValue = deepObservable(newValue, { parent: object, name });
          }
        }
        meta._onChange([meta.path, { [name]: newValue }]);
        return { object, type, name, newValue };
      default:
        console.log("not handled type", type);
        return change;
    }
  });

  return obj;
};

it("observes prop changes", () => {
  let lastChange;
  const obj = deepObservable(
    { a: "A" },
    {
      onChange: change => {
        lastChange = change;
      }
    }
  );
  console.log(obj);
  console.log(lastChange);

  expect(isDeepObservable(obj)).toEqual(true);

  extendObservable(obj, { b: { b: "B" } });
  expect(isDeepObservable(obj.b)).toEqual(true);

  console.log(lastChange);
  console.log(JSON.stringify(lastChange));

  obj.b.b = "c";
  console.log(lastChange);

  expect(getMeta(obj.b).path).toEqual(["b"]);
  expect(getMeta(obj).path).toEqual([]);

  // obj.a = "B";
  obj.b; //?
  console.log(obj.a);
  console.log(obj.b.b);

  // obj.b.b = "C";

  console.log(obj.b.parent);

  // expect(true).toEqual(false);

  // obj.a = "C";
  // obj.a = null;
});

it("knows about Gun", async () => {
  // const gun = Gun({ localStorage: false });
  const gun = Gun({ file: "test.json" });

  let doc = gun.get("doc"); //.get("user");

  gun._.soul; //?

  Object.keys(doc._); //?
  doc._.soul; //?

  doc.put({ key: "value" });

  const value = await new Promise(resolve => doc.val(resolve)); //?

  await new Promise(resolve => setTimeout(resolve, 10));
});
