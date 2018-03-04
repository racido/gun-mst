const { types, applySnapshot, getSnapshot } = require("mobx-state-tree");
const Gun = require("gun");

const {
  ModelFactory,
  StoreFactory,
  reference,
  arrayReference
} = require("./index");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

it("exists", () => {
  expect(StoreFactory).toBeDefined();
});

describe("Store Creation", () => {
  let gun;

  beforeEach(async () => {
    gun = Gun({ localStorage: false });
  });

  it("creates a store", () => {
    const Project = ModelFactory("Project", {}).props({
      title: types.maybe(types.string)
    });

    const store = StoreFactory([Project]).create({}, { gun });

    const doc = store.create(Project, { id: "test", title: "TITLE" });

    expect(doc.isLoaded).toEqual(true);
  });

  it(
    "store can store instances",
    async () => {
      const Project = ModelFactory("Project", {})
        .props({
          title: types.maybe(types.string)
        })
        .actions(self => ({
          setTitle(title) {
            self.title = title;
          }
        }));

      const Store = StoreFactory([Project]);
      const store1 = Store.create({}, { gun, storeId: 1 });
      const store2 = Store.create({}, { gun, storeId: 2 });

      const doc1 = store1.create(Project, { id: "test", title: "TITLE" });

      expect(doc1.isLoaded).toEqual(true);
      expect(store1.projects.has("test")).toEqual(true);
      expect(store2.projects.has("test")).toEqual(false);

      const doc2Request = store2.getOrLoad(Project, "test");
      expect(doc2Request.id).toEqual("test");
      expect(doc2Request.isLoaded).toEqual(false);
      expect(doc2Request.isLoading).toEqual(true);

      expect(store2.projects.has("test")).toEqual(false);

      const doc2 = await doc2Request.whenLoaded;
      expect(doc2.title).toEqual("TITLE");

      doc1.setTitle("TJOP");

      expect(doc2.title).toEqual("TJOP");
      // expect(true).toEqual(false);
    },
    1000
  );

  it("supports references (many to one)", () => {
    let projectUpdates = 0;
    const Project = ModelFactory("Project", {
      processGunChange: self => snapshot => {
        projectUpdates++;
        applySnapshot(self, { ...getSnapshot(self), ...snapshot });
      }
    }).props({
      title: types.maybe(types.string)
    });

    let goalUpdates = 0;
    const Goal = ModelFactory("Goal", {
      props: {
        description: types.maybe(types.string)
      },
      references: {
        project: Project
      },
      processGunChange: self => snapshot => {
        goalUpdates++;
        applySnapshot(self, { ...getSnapshot(self), ...snapshot });
      }
    }).actions(self => ({
      updateDescription(description) {
        self.description = description;
      }
    }));

    const store = StoreFactory([Project, Goal]).create({}, { gun });

    const project = store.create(Project, { id: "test", title: "TITLE" });
    const goal = store.create(Goal, {
      id: "goal",
      description: "todo",
      project: "test"
    });

    expect(project.title).toEqual("TITLE");
    expect(goal.description).toEqual("todo");
    expect(goal.project.title).toEqual("TITLE");

    expect(projectUpdates).toEqual(1);
    expect(goalUpdates).toEqual(1);

    goal.updateDescription("test");

    expect(projectUpdates).toEqual(1);
    expect(goalUpdates).toEqual(2);
    expect(goal.description).toEqual("test");
  });

  it("supports array references (one to many)", () => {
    let goalUpdates = 0;
    const Goal = ModelFactory("Goal", {
      props: {
        description: types.maybe(types.string)
      },
      processGunChange: self => snapshot => {
        goalUpdates++;
        applySnapshot(self, { ...getSnapshot(self), ...snapshot });
      }
    });

    let projectUpdates = 0;
    const Project = ModelFactory("Project", {
      processGunChange: self => snapshot => {
        projectUpdates++;
        applySnapshot(self, { ...getSnapshot(self), ...snapshot });
      },
      references: {
        goals: [Goal]
      }
    })
      .props({
        title: types.maybe(types.string)
      })
      .actions(self => ({
        addGoal(goal) {
          self.goals.push(goal);
        }
      }));

    const store = StoreFactory([Project, Goal]).create({}, { gun });

    const goal = store.create(Goal, {
      id: "goal1",
      description: "todo1"
    });
    const project = store.create(Project, {
      id: "test2",
      title: "TITLE",
      goals: ["goal1"]
    });

    expect(project.title).toEqual("TITLE");
    expect(goal.description).toEqual("todo1");
    expect(project.goals[0].description).toEqual("todo1");

    expect(projectUpdates).toEqual(0);
    expect(goalUpdates).toEqual(1);

    const goal2 = store.create(Goal, {
      id: "goal2",
      description: "todo2"
    });
    project.addGoal(goal2);
    expect(projectUpdates).toEqual(1);
    expect(project.goals[1].description).toEqual("todo2");

    // goal.updateDescription("test");
    // expect(projectUpdates).toEqual(0);
    // expect(goalUpdates).toEqual(2);
    // expect(goal.description).toEqual("test");
  });
});
