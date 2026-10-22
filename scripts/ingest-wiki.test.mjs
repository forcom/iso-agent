import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, cp, mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('re-ingest is deterministic and refuses changed sources without overwriting the seed', async () => {
  const source = fileURLToPath(new URL('../', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'iso-wiki-check-'));
  try {
    for (const dir of ['scripts','seed','docs/manual','docs/procedure','docs/guide','packages/ontology']) {
      await mkdir(join(root,dir), { recursive:true });
    }
    for (const path of ['scripts/ingest-wiki.mjs','seed','docs/manual','docs/procedure','docs/guide','packages/ontology/rules.dl']) {
      await cp(join(source,path),join(root,path),{recursive:true});
    }
    const run = (...args) => spawnSync(process.execPath,[join(root,'scripts/ingest-wiki.mjs'),...args],{encoding:'utf8'});
    const before = await readFile(join(root,'seed/example-persons-roles.json'),'utf8');
    const check = run('--check');
    assert.equal(check.status,0,check.stderr);
    const rebuild = run();
    assert.equal(rebuild.status,0,rebuild.stderr);
    assert.equal(await readFile(join(root,'seed/example-persons-roles.json'),'utf8'),before);
    const seedPath = join(root,'seed/example-persons-roles.json');
    const draftSeed = JSON.parse(before);
    const draft = draftSeed.facts.find(f => f.id.startsWith('fact:seed:iso:') && f.subject.startsWith('doc:'));
    assert(draft);
    draft.status = 'draft';
    await writeFile(seedPath,JSON.stringify(draftSeed));
    const withoutDraft = run();
    assert.equal(withoutDraft.status,0,withoutDraft.stderr);
    const regenerated = JSON.parse(await readFile(seedPath,'utf8'));
    for (const page of regenerated.wiki_pages.filter(p => p.status === 'approved')) {
      for (const claim of page.claims) {
        assert(!(claim.fact_ids ?? []).includes(draft.id), 'draft fact must not be an approved Wiki reference');
        assert(!claim.text.split('\n').includes(`- ${draft.subject} → ${draft.predicate} → ${draft.object}`), 'draft triple must not become approved prose');
      }
    }
    draftSeed.facts.find(f => f.id === 'fact:seed:addr-062a').status = 'draft';
    const inconsistent = JSON.stringify(draftSeed);
    await writeFile(seedPath,inconsistent);
    const legacyDraft = run();
    assert.notEqual(legacyDraft.status,0,'retained approved pages referencing draft facts require review');
    assert.match(legacyDraft.stderr,/unapproved fact/);
    assert.equal(await readFile(seedPath,'utf8'),inconsistent);
    await writeFile(seedPath,before);
    await appendFile(join(root,'docs/guide/AIDU-AIG-08-02.md'),'\nChanged source\n');
    const drift = run();
    assert.notEqual(drift.status,0);
    assert.match(drift.stderr,/source changed/);
    assert.equal(await readFile(join(root,'seed/example-persons-roles.json'),'utf8'),before);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
