const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(
  path.join(__dirname, '..', 'workflow', 'leads_notification_folder_scan.json'),
  'utf8'
);
const workflow = JSON.parse(raw);

const nodeCode = (name) => workflow.nodes.find((n) => n.name === name).parameters.jsCode;

function checkRows(state, file, rows) {
  const fn = new Function('$getWorkflowStaticData', '$input', '$', nodeCode('Check for new rows'));
  return fn(
    () => state,
    { all: () => rows.map((json) => ({ json })) },
    () => ({ item: { json: file } })
  );
}

function buildSummary(state) {
  const fn = new Function('$getWorkflowStaticData', nodeCode('Build summary email'));
  return fn(() => state);
}

const lead = (n) => ({
  Nome: `Lead ${n}`,
  Email: `lead${n}@example.com`,
  'Horário de Preenchimento': `2026-01-0${n}T09:00:00.000-03:00`,
});

const fileA = { id: 'file-a', name: 'Leads - Video A' };
const fileB = { id: 'file-b', name: 'Leads - Video B' };

const tests = {
  'first run treats every existing row as new'() {
    const state = {};
    checkRows(state, fileA, [lead(1), lead(2)]);
    assert.strictEqual(state.pendingLeads.length, 2);
    assert.strictEqual(state['file-a'], 2);
  },

  'a run with no new rows sends no email'() {
    const state = {};
    checkRows(state, fileA, [lead(1)]);
    buildSummary(state);
    checkRows(state, fileA, [lead(1)]);
    assert.deepStrictEqual(buildSummary(state), []);
  },

  'only rows added since the last run are queued'() {
    const state = {};
    checkRows(state, fileA, [lead(1)]);
    buildSummary(state);
    checkRows(state, fileA, [lead(1), lead(2)]);
    assert.deepStrictEqual(state.pendingLeads.map((l) => l.Nome), ['Lead 2']);
  },

  'each sheet is tracked separately and labeled with its file name'() {
    const state = {};
    checkRows(state, fileA, [lead(1)]);
    checkRows(state, fileB, [lead(2), lead(3)]);
    const [{ json }] = buildSummary(state);
    assert.strictEqual(json.count, 3);
    assert.ok(json.emailBody.includes('<b>Leads - Video A</b>: Lead 1, lead1@example.com'));
    assert.ok(json.emailBody.includes('<b>Leads - Video B</b>: Lead 3, lead3@example.com'));
  },

  'building the summary empties the queue'() {
    const state = {};
    checkRows(state, fileA, [lead(1)]);
    buildSummary(state);
    assert.deepStrictEqual(state.pendingLeads, []);
  },

  'files without lead columns add nothing'() {
    const state = {};
    checkRows(state, fileA, [{ error: 'not a spreadsheet' }]);
    assert.deepStrictEqual(state.pendingLeads, []);
    assert.strictEqual(state['file-a'], 0);
  },

  'known limitation: a failed read resets the count and re-sends the sheet next run'() {
    const state = {};
    checkRows(state, fileA, [lead(1), lead(2)]);
    buildSummary(state);
    checkRows(state, fileA, [{ error: 'temporary failure' }]);
    checkRows(state, fileA, [lead(1), lead(2)]);
    assert.strictEqual(state.pendingLeads.length, 2);
  },

  'known limitation: deleting rows can hide a new lead'() {
    const state = {};
    checkRows(state, fileA, [lead(1), lead(2), lead(3)]);
    buildSummary(state);
    checkRows(state, fileA, [lead(1), lead(4)]);
    assert.deepStrictEqual(state.pendingLeads, []);
  },

  'the published file holds no real identifiers'() {
    assert.ok(!/@(?!example\.com)[a-z0-9-]+\.[a-z]{2,}/i.test(raw), 'unexpected email address');
    assert.ok(!raw.includes('drive.google.com'), 'Drive URL present');
    for (const key of ['webhookId', 'instanceId', 'versionId']) {
      assert.ok(!raw.includes(`"${key}"`), `${key} present`);
    }
    assert.strictEqual(workflow.id, undefined);
    for (const node of workflow.nodes) {
      for (const cred of Object.values(node.credentials || {})) {
        assert.strictEqual(cred.id, 'YOUR_CREDENTIAL_ID');
      }
    }
  },
};

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try {
    test();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
}
console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
