const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PAGE_SIZE,
  buildTrpcUrl,
  fetchAllTasks,
  fetchDashboardForProject,
  mergeClaimedTasksWithPastHistory,
  normalizeProjectInput,
  normalizeTask,
} = require("./platform-api");

const PROJECT_URL =
  "https://ai.joinhandshake.com/fellow/projects/past/26a53071-8843-4138-97df-430bd3e4cd45";
const STORAGE = { cookies: [{ name: "s", value: "1", domain: "ai.joinhandshake.com", path: "/" }] };

function tasksPayload(ids) {
  const activeTasks = ids.map((id) => ({ id }));
  return [{ result: { data: { json: { activeTasks, pastTasks: [] } } } }];
}

function richTasksPayload(tasks) {
  return [{ result: { data: { json: { activeTasks: tasks, pastTasks: [] } } } }];
}

function historyPayload(rows) {
  return [{ result: { data: { json: { tasks: rows } } } }];
}

function mockFetchPage(pagesByOffset) {
  return async (_projectUrl, _storageState, _limit, offset) => {
    if (Object.hasOwn(pagesByOffset, offset)) return pagesByOffset[offset];
    const err = new Error("Tasks API failed with status 500.");
    throw err;
  };
}

function mockFetchPageWithLimitRules(rules) {
  return async (_projectUrl, _storageState, limit, offset) => {
    for (const rule of rules) {
      if (rule.offset !== offset) continue;
      if (rule.limitMin !== undefined && limit < rule.limitMin) continue;
      if (rule.limitMax !== undefined && limit > rule.limitMax) continue;
      if (rule.limit !== undefined && limit !== rule.limit) continue;
      if (rule.throw500) throw new Error("Tasks API failed with status 500.");
      return rule.payload;
    }
    throw new Error(`unexpected offset ${offset} limit ${limit}`);
  };
}

test("normalizeProjectInput accepts project IDs and project URLs", () => {
  assert.deepEqual(
    normalizeProjectInput("26a53071-8843-4138-97df-430bd3e4cd45"),
    {
      projectId: "26a53071-8843-4138-97df-430bd3e4cd45",
      projectUrl:
        "https://ai.joinhandshake.com/fellow/projects/past/26a53071-8843-4138-97df-430bd3e4cd45",
    }
  );
  assert.deepEqual(
    normalizeProjectInput(
      "https://ai.joinhandshake.com/fellow/projects/active/a1c6c53b-cfad-414e-bad6-c9a68f7ee902"
    ),
    {
      projectId: "a1c6c53b-cfad-414e-bad6-c9a68f7ee902",
      projectUrl:
        "https://ai.joinhandshake.com/fellow/projects/active/a1c6c53b-cfad-414e-bad6-c9a68f7ee902",
    }
  );
});

test("buildTrpcUrl encodes batched tRPC input", () => {
  const url = new URL(
    buildTrpcUrl("annotationProject.listByProfileId", {
      profileId: "profile-1",
    })
  );

  assert.equal(url.pathname, "/api/trpc/annotationProject.listByProfileId");
  assert.equal(url.searchParams.get("batch"), "1");
  assert.deepEqual(JSON.parse(url.searchParams.get("input")), {
    "0": { json: { profileId: "profile-1" } },
  });
});

test("PAGE_SIZE defaults to 10", () => {
  assert.equal(PAGE_SIZE, 10);
});

test("fetchAllTasks stops after a short page without another request", async () => {
  const calls = [];
  const fetchPage = async (...args) => {
    calls.push(args[3]);
    return tasksPayload(["a", "b", "c", "d", "e"]);
  };

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
  });

  assert.equal(tasks.length, 5);
  assert.deepEqual(calls, [0]);
});

test("fetchAllTasks pages until a partial last page", async () => {
  const calls = [];
  const fetchPage = async (...args) => {
    const offset = args[3];
    calls.push(offset);
    if (offset === 0) return tasksPayload(Array.from({ length: 10 }, (_, i) => `t${i}`));
    return tasksPayload(["t10", "t11", "t12"]);
  };

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
  });

  assert.equal(tasks.length, 13);
  assert.deepEqual(calls, [0, 10]);
});

test("fetchAllTasks retries 500 on a full next page and returns all tasks", async () => {
  const calls = [];
  const failuresAtOffset10 = { count: 0 };
  const fetchPage = async (...args) => {
    const offset = args[3];
    calls.push(offset);
    if (offset === 0) {
      return tasksPayload(Array.from({ length: 10 }, (_, i) => `t${i}`));
    }
    if (offset === 10) {
      failuresAtOffset10.count += 1;
      if (failuresAtOffset10.count < 3) {
        throw new Error("Tasks API failed with status 500.");
      }
      return tasksPayload(Array.from({ length: 8 }, (_, i) => `t${i + 10}`));
    }
    throw new Error(`unexpected offset ${offset}`);
  };

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
    retryDelays: [0, 0],
  });

  assert.equal(tasks.length, 18);
  assert.equal(failuresAtOffset10.count, 3);
  assert.deepEqual(
    calls.filter((offset) => offset === 10).length,
    3
  );
});

test("fetchAllTasks halving recovers tail when full page 500s at offset 10", async () => {
  const fetchPage = mockFetchPageWithLimitRules([
    {
      offset: 0,
      limitMin: 10,
      payload: tasksPayload(Array.from({ length: 10 }, (_, i) => `t${i}`)),
    },
    { offset: 10, limit: 10, throw500: true },
    {
      offset: 10,
      limitMax: 5,
      payload: tasksPayload(Array.from({ length: 5 }, (_, i) => `t${i + 10}`)),
    },
    { offset: 15, limitMin: 1, throw500: true },
  ]);

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
    retryDelays: [0, 0, 0],
  });

  assert.equal(tasks.length, 15);
});

test("fetchAllTasks keeps reduced limit after halving for 25 tasks", async () => {
  const fetchPage = async (_url, _state, limit, offset) => {
    if (offset === 0 && limit >= 10) {
      return tasksPayload(Array.from({ length: 10 }, (_, i) => `t${i}`));
    }
    if (limit >= 10) {
      throw new Error("Tasks API failed with status 500.");
    }
    const remaining = 25 - offset;
    const count = Math.min(limit, remaining);
    if (count <= 0) return tasksPayload([]);
    return tasksPayload(Array.from({ length: count }, (_, i) => `t${offset + i}`));
  };

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
    retryDelays: [0, 0, 0],
  });

  assert.equal(tasks.length, 25);
});

test("fetchAllTasks halving recovers 18 tasks when page 2 needs smaller limit", async () => {
  const fetchPage = mockFetchPageWithLimitRules([
    {
      offset: 0,
      limitMin: 10,
      payload: tasksPayload(Array.from({ length: 10 }, (_, i) => `t${i}`)),
    },
    { offset: 10, limit: 10, throw500: true },
    {
      offset: 10,
      limitMax: 5,
      payload: tasksPayload(Array.from({ length: 8 }, (_, i) => `t${i + 10}`)),
    },
    { offset: 18, limitMin: 1, throw500: true },
  ]);

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
    retryDelays: [0, 0, 0],
  });

  assert.equal(tasks.length, 18);
});

test("fetchAllTasks stops at true end when limit 1 also 500s", async () => {
  const fetchPage = mockFetchPageWithLimitRules([
    {
      offset: 0,
      limitMin: 10,
      payload: tasksPayload(Array.from({ length: 10 }, (_, i) => `t${i}`)),
    },
    { offset: 10, limitMin: 1, throw500: true },
  ]);

  const tasks = await fetchAllTasks(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
    retryDelays: [0, 0, 0],
  });

  assert.equal(tasks.length, 10);
});

test("mergeClaimedTasksWithPastHistory adds history-only task ids", () => {
  const merged = mergeClaimedTasksWithPastHistory(
    [{ id: "t1", title: "From list" }],
    [
      { taskId: "t1", lastWorkedAt: "2026-05-01T00:00:00Z" },
      { taskId: "t2", lastWorkedAt: "2026-05-02T00:00:00Z" },
    ],
    "project-1"
  );

  assert.equal(merged.length, 2);
  assert.equal(merged.find((t) => t.id === "t1").title, "From list");
  assert.equal(merged.find((t) => t.id === "t2").lastWorkedAt, "2026-05-02T00:00:00Z");
});

test("fetchDashboardForProject still loads when past history API fails", async () => {
  const fetchPage = async (_url, _state, _limit, offset) => {
    if (offset !== 0) return tasksPayload([]);
    return tasksPayload(["t1", "t2"]);
  };
  const fetchProfile = async () => ({ id: "profile-1" });
  const fetchTrpc = async () => {
    throw new Error("Past project history API failed with status 400.");
  };

  const dashboard = await fetchDashboardForProject(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
    fetchProfile,
    fetchTrpc,
    project: { id: "p-1", name: "Project H" },
  });

  assert.equal(dashboard.tasks.length, 2);
  assert.match(dashboard.historyWarning, /past-project task history/i);
});

test("fetchDashboardForProject merges past project history for past URLs", async () => {
  const fetchPage = async (_url, _state, _limit, offset) => {
    if (offset !== 0) return tasksPayload([]);
    return tasksPayload(Array.from({ length: 10 }, (_, i) => `listed-${i}`));
  };
  const fetchProfile = async () => ({ id: "profile-1" });
  const fetchTrpc = async (procedure, input) => {
    assert.equal(procedure, "annotationProject.listPastProjectTaskHistoryForFellow");
    assert.deepEqual(input, {
      projectId: "26a53071-8843-4138-97df-430bd3e4cd45",
      profileId: "profile-1",
    });
    return {
      tasks: [
        { taskId: "listed-0", lastWorkedAt: "2026-05-01T00:00:00Z" },
        { taskId: "history-only", lastWorkedAt: "2026-05-03T00:00:00Z" },
      ],
    };
  };

  const dashboard = await fetchDashboardForProject(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
    fetchProfile,
    fetchTrpc,
    project: { id: "26a53071-8843-4138-97df-430bd3e4cd45", name: "Project H" },
  });

  assert.equal(dashboard.tasks.length, 11);
  assert.ok(dashboard.tasks.some((t) => t.id === "history-only"));
});

test("fetchDashboardForProject returns 18 rows with pr titles and history-only stubs", async () => {
  const mainTasks = Array.from({ length: 15 }, (_, i) => ({
    id: `listed-${i}`,
    pipelineStage: { name: "Delivered" },
    buildStatus: "passing",
    data: { pr_title: `PR ${i}` },
  }));

  const fetchPage = async (_url, _state, _limit, offset) => {
    if (offset !== 0) return tasksPayload([]);
    return richTasksPayload(mainTasks);
  };

  const fetchProfile = async () => ({ id: "profile-1" });
  const fetchTrpc = async (procedure, input) => {
    assert.equal(procedure, "annotationProject.listPastProjectTaskHistoryForFellow");
    assert.deepEqual(input, {
      projectId: "26a53071-8843-4138-97df-430bd3e4cd45",
      profileId: "profile-1",
    });
    return {
      tasks: [
        ...Array.from({ length: 15 }, (_, i) => ({
          taskId: `listed-${i}`,
          lastWorkedAt: `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
          totalTimeWorkedInSeconds: 60,
        })),
        { taskId: "hist-15", lastWorkedAt: "2026-05-16T00:00:00Z" },
        { taskId: "hist-16", lastWorkedAt: "2026-05-17T00:00:00Z" },
        { taskId: "hist-17", lastWorkedAt: "2026-05-18T00:00:00Z" },
      ],
    };
  };

  const dashboard = await fetchDashboardForProject(PROJECT_URL, STORAGE, {
    pageSize: 10,
    fetchPage,
    fetchProfile,
    fetchTrpc,
    project: { id: "26a53071-8843-4138-97df-430bd3e4cd45", name: "Project H" },
  });

  assert.equal(dashboard.tasks.length, 18);
  assert.equal(dashboard.tasks.find((t) => t.id === "listed-3").title, "PR 3");
  assert.equal(dashboard.tasks.find((t) => t.id === "hist-15").title, "");
  assert.equal(dashboard.tasks.find((t) => t.id === "hist-15").updatedAt, "2026-05-16T00:00:00Z");
  assert.equal(dashboard.tasks.find((t) => t.id === "listed-0").stage, "Delivered");
});

test("fetchAllTasks rethrows 500 on the first page", async () => {
  const fetchPage = async () => {
    throw new Error("Tasks API failed with status 500.");
  };

  await assert.rejects(
    () => fetchAllTasks(PROJECT_URL, STORAGE, { pageSize: 10, fetchPage }),
    /status 500/
  );
});

test("normalizeTask extracts stage, title, and updatedAt", () => {
  const task = normalizeTask(
    {
      id: "t-1",
      pipelineStage: { name: "Delivered", enteredAt: "2026-05-22T10:00:00Z" },
      buildStatus: "passing",
      data: { task_title: "Finish thing" },
    },
    { id: "p-1", name: "Project H" }
  );

  assert.deepEqual(task, {
    id: "t-1",
    projectId: "p-1",
    projectName: "Project H",
    stage: "Delivered",
    buildStatus: "passing",
    title: "Finish thing",
    updatedAt: "2026-05-22T10:00:00Z",
  });
});

test("normalizeTask uses pr_title when task_title is missing", () => {
  const task = normalizeTask(
    {
      id: "t-2",
      pipelineStage: { name: "Review" },
      data: { pr_title: "Fix login bug" },
    },
    { id: "p-1", name: "Project H" }
  );

  assert.equal(task.title, "Fix login bug");
});

const { listProjects, getHoursWorked } = require("./platform-api");

test("listProjects merges active + past projects with a kind tag", async () => {
  const calls = [];
  const fakeTrpc = async (procedure, input) => {
    calls.push(procedure);
    if (procedure === "annotationProject.listByProfileId") {
      return { annotationProjects: [{ id: "p1", name: "Project Baseball" }] };
    }
    if (procedure === "annotationProject.listPastProjectsByProfileId") {
      return { projects: [{ id: "p2", name: "Project Spectra" }] };
    }
    throw new Error("unexpected " + procedure);
  };
  const projects = await listProjects(STORAGE, "prof-1", { fetchTrpc: fakeTrpc });
  assert.deepEqual(projects, [
    { id: "p1", name: "Project Baseball", kind: "active" },
    { id: "p2", name: "Project Spectra", kind: "past" },
  ]);
  assert.deepEqual(calls.sort(), [
    "annotationProject.listByProfileId",
    "annotationProject.listPastProjectsByProfileId",
  ]);
});

test("listProjects dedupes by id, preferring active", async () => {
  const fakeTrpc = async (procedure) => {
    if (procedure === "annotationProject.listByProfileId") {
      return { annotationProjects: [{ id: "dup", name: "Active Name" }] };
    }
    return { projects: [{ id: "dup", name: "Past Name" }] };
  };
  const projects = await listProjects(STORAGE, "prof-1", { fetchTrpc: fakeTrpc });
  assert.deepEqual(projects, [{ id: "dup", name: "Active Name", kind: "active" }]);
});

const { fetchAllTasksForProject } = require("./platform-api");

test("getHoursWorked returns seconds + hours from the platform", async () => {
  const fakeTrpc = async (procedure, input) => {
    assert.equal(procedure, "fellow.getHoursWorked");
    assert.deepEqual(input, { fellowId: "prof-1" });
    return { totalTimeWorkedInSeconds: 466780, totalHours: 129.7 };
  };
  const result = await getHoursWorked(STORAGE, "prof-1", { fetchTrpc: fakeTrpc });
  assert.deepEqual(result, { totalSeconds: 466780, totalHours: 129.7 });
});

test("fetchAllTasksForProject pages raw tasks for a project id", async () => {
  const fetchPage = mockFetchPage({
    0: richTasksPayload([{ id: "t1", annotationProjectActivities: [] }]),
    1: richTasksPayload([]),
  });
  const tasks = await fetchAllTasksForProject("26a53071-8843-4138-97df-430bd3e4cd45", STORAGE, {
    fetchPage,
    pageSize: 1,
  });
  assert.deepEqual(tasks.map((t) => t.id), ["t1"]);
});

const { fetchWeeklyHoursDashboard } = require("./platform-api");

test("fetchWeeklyHoursDashboard aggregates tasks across all projects", async () => {
  const deps = {
    fetchProfile: async () => ({ id: "me", name: "Ming" }),
    listProjects: async () => [
      { id: "pA", name: "Project Baseball", kind: "active" },
      { id: "pB", name: "Project Fade", kind: "active" },
    ],
    fetchAllTasksForProject: async (projectId) => {
      if (projectId === "pA") {
        return [{ id: "a1", annotationProjectActivities: [
          { profileId: "me", timeWorkedInSeconds: 3600, createdAt: "2026-05-18T09:00:00Z" }] }];
      }
      return [{ id: "b1", annotationProjectActivities: [
        { profileId: "me", timeWorkedInSeconds: 1800, createdAt: "2026-05-19T09:00:00Z" }] }];
    },
    getHoursWorked: async () => ({ totalSeconds: 5400, totalHours: 1.5 }),
    now: () => "2026-06-10T00:00:00.000Z",
  };
  const result = await fetchWeeklyHoursDashboard(STORAGE, deps);
  assert.equal(result.profile.name, "Ming");
  assert.equal(result.lifetime.totalHours, 1.5);
  assert.equal(result.totals.seconds, 5400);
  assert.equal(result.weeks[0].weekStart, "2026-05-18");
  assert.deepEqual(result.projects.map((p) => [p.name, p.taskCount]), [
    ["Project Baseball", 1], ["Project Fade", 1],
  ]);
  // Each project carries its own weekly breakdown for the project filter.
  assert.equal(result.projects[0].weeks[0].weekStart, "2026-05-18");
  assert.equal(result.projects[0].totals.hours, 1);
  assert.equal(result.projects[1].weeks[0].weekStart, "2026-05-18");
  assert.equal(result.projects[1].totals.hours, 0.5);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.generatedAt, "2026-06-10T00:00:00.000Z");
});

test("fetchWeeklyHoursDashboard records a warning when one project fails", async () => {
  const deps = {
    fetchProfile: async () => ({ id: "me", name: "Ming" }),
    listProjects: async () => [
      { id: "ok", name: "Good", kind: "active" },
      { id: "bad", name: "Broken", kind: "past" },
    ],
    fetchAllTasksForProject: async (projectId) => {
      if (projectId === "bad") throw new Error("status 500");
      return [{ id: "x", annotationProjectActivities: [
        { profileId: "me", timeWorkedInSeconds: 3600, createdAt: "2026-05-18T09:00:00Z" }] }];
    },
    getHoursWorked: async () => ({ totalSeconds: 3600, totalHours: 1 }),
    now: () => "2026-06-10T00:00:00.000Z",
  };
  const result = await fetchWeeklyHoursDashboard(STORAGE, deps);
  assert.equal(result.totals.seconds, 3600);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Broken/);
});
