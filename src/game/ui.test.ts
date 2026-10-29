import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');
const code = readdirSync('src/game').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => readFileSync(`src/game/${f}`, 'utf8')).join('\n');
const buttonIds = [...html.matchAll(/<button id="([\w-]+)"/g)].map((m) => m[1]);
const dialogIds = [...html.matchAll(/<dialog id="([\w-]+)"/g)].map((m) => m[1]);

describe('buttons', () => {
  it('finds the header buttons', () => expect(buttonIds).toEqual(expect.arrayContaining(['ach', 'help', 'music', 'sfx', 'credits-btn', 'buy'])));
  it.each(buttonIds)('#%s has a click handler', (id) => {
    expect(code).toMatch(new RegExp(`\\$\\('${id}'\\)\\.onclick|el\\('${id}'\\)|getElementById\\('${id}'\\)`));
    expect(code).toMatch(new RegExp(`(\\$|el)\\('${id}'\\)[^;\\n]*(onclick|addEventListener)|${id}.*onclick`));
  });
  it.each(dialogIds)('dialog #%s is opened by a button', (id) => {
    expect(code).toMatch(new RegExp(`\\$\\('${id}'\\) as HTMLDialogElement\\)\\.showModal`));
  });
  it('every dialog has a Close button', () => {
    for (const d of html.split('<dialog ').slice(1)) expect(d.split('</dialog>')[0]).toContain('<form method="dialog"');
  });
});

describe('credits', () => {
  const files = ['fonts', 'audio/music', 'audio/sfx'].flatMap((d) => readdirSync(`assets/${d}`).filter((f) => /\.(ttf|ogg|mp3|wav)$/.test(f)).map((f) => `assets/${d}/${f}`));
  const md = readFileSync('CREDITS.md', 'utf8');
  it.each(files)('%s is in CREDITS.md', (f) => expect(md).toContain(f.split('/').pop()!.replace(/\.\w+$/, '')));
  const authors = [...md.matchAll(/^\| [^|]+\| ([^|]+) \| https/gm)].map((m) => m[1].trim().split(' (')[0]);
  it.each(authors)('credits dialog names author %s', (a) => expect(html).toContain(a));
  it('credits dialog names the music author', () => expect(html).toContain('Cakeflaps'));
  it('credits dialog has no removed tracks', () => expect(html).not.toMatch(/Cunning|Concentration|Chiptune/));
});
