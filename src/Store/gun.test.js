const Gun = require("gun/gun");

const delay = ms => new Promise(resolve => setTimeout(resolve), ms);

it("loads", () => {
  expect(Gun).toBeDefined();
});

it("in memory gun 1- can create an in memory instance", async () => {
  const gun = Gun({ file: null });
  expect(gun).toBeDefined();
  gun.get("uniqid").put({ test: "TEST" });

  await delay(10);

  const val = await new Promise(resolve => gun.get("uniqid").val(resolve));
  expect(val.test).toEqual("TEST");
});

it("in memory gun 2- tests run in isolation", async () => {
  const gun = Gun({ file: null });
  await delay(10);
  const val = await new Promise(resolve => gun.get("uniqid").val(resolve));
  expect(val).toBeUndefined();
});
