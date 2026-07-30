import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, readJson } from "../src/lib/source-first.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILE = path.join(ROOT, "data", "editorial", "people.json");
const ROLES = new Set(["editor", "veterinary-reviewer", "administrator"]);
const STORAGE_ROLES = { editor: "editor", "veterinary-reviewer": "vet", administrator: "admin" };
const PLACEHOLDERS = /^(?:example|test|sample|placeholder|홍길동|john doe|jane doe)$/i;

function parse() {
  const raw = process.argv.slice(2); const command = raw.shift() || "list"; const positional = []; const flags = {};
  for (let i = 0; i < raw.length; i += 1) { const token = raw[i]; if (!token.startsWith("--")) { positional.push(token); continue; } const key = token.slice(2); flags[key] = raw[i + 1] && !raw[i + 1].startsWith("--") ? raw[++i] : true; }
  return { command, positional, flags };
}
function load() { const value = readJson(FILE, { version: 1, people: [] }); return Array.isArray(value) ? { version: 1, people: value } : { version: value.version || 1, people: Array.isArray(value.people) ? value.people : [] }; }
function validatePerson(person, { allowDisabled = true } = {}) {
  const errors = [];
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(String(person.id || ""))) errors.push("id는 영문 소문자로 시작하는 3~64자 식별자여야 합니다.");
  if (!String(person.name || "").trim() || String(person.name).trim().length < 2 || PLACEHOLDERS.test(String(person.name).trim())) errors.push("빈 이름·placeholder 이름은 허용하지 않습니다.");
  if (!ROLES.has(person.inputRole || person.roleLabel || person.role)) errors.push("role은 editor, veterinary-reviewer, administrator 중 하나여야 합니다.");
  const role = person.inputRole || person.roleLabel || person.role;
  if (role === "veterinary-reviewer") { if (!String(person.credentials || "").trim()) errors.push("veterinary-reviewer에는 확인된 credentials가 필요합니다."); if (!String(person.profileUrl || "").match(/^https:\/\//)) errors.push("veterinary-reviewer에는 HTTPS profileUrl이 필요합니다."); }
  if (!allowDisabled && person.active === false) errors.push("비활성화된 사람은 사용할 수 없습니다.");
  return errors;
}
function redact(person) { const copy = { ...person }; if (copy.licenseNumber) copy.licenseNumber = "[redacted]"; return copy; }
function output(value) { console.log(JSON.stringify(value, null, 2)); }
function list() { const data = load(); output({ people: data.people.map(redact), count: data.people.filter((p) => p.active !== false).length, reviewerCount: data.people.filter((p) => p.active !== false && ["editor", "vet", "admin"].includes(p.role)).length, note: data.people.length ? "등록 정보만 표시합니다. 사람 등록으로 기사 승인 상태는 자동 변경되지 않습니다." : "실제 편집자 등록 필요: npm run people:add -- --id <id> --name <name> --role <role>" }); }
function validate() { const data = load(); const errors = data.people.flatMap((person) => validatePerson({ ...person, inputRole: person.role === "vet" ? "veterinary-reviewer" : person.role === "admin" ? "administrator" : person.role }, { allowDisabled: true }).map((error) => `${person.id || "(unknown)"}: ${error}`)); output({ valid: errors.length === 0, people: data.people.length, errors }); if (errors.length) process.exitCode = 1; }
function add(flags) {
  const required = ["id", "name", "role"]; const missing = required.filter((key) => !String(flags[key] || "").trim()); if (missing.length) throw new Error(`필수 인자 누락: ${missing.map((x) => `--${x}`).join(", ")}`);
  const person = { id: String(flags.id).trim(), name: String(flags.name).trim(), inputRole: String(flags.role).trim(), role: STORAGE_ROLES[String(flags.role).trim()], active: true, profileUrl: flags["profile-url"] || null, credentials: flags.credentials || null, specialties: flags.specialties ? String(flags.specialties).split(",").map((x) => x.trim()).filter(Boolean) : [] };
  const errors = validatePerson(person); if (errors.length) throw new Error(errors.join("\n"));
  const data = load(); if (data.people.some((p) => p.id === person.id)) throw new Error(`이미 등록된 id입니다: ${person.id}`);
  const stored = { ...person }; delete stored.inputRole; const plan = { action: "add", dryRun: !flags.apply, person: redact(stored), note: "등록만으로 기존 기사를 승인하거나 발행하지 않습니다." }; output(plan); if (!flags.apply) { console.log("dry-run: 실제 저장은 --apply를 명시해야 합니다."); return; } if (!flags.confirm) throw new Error("실제 저장에는 --confirm도 필요합니다."); data.people.push(stored); atomicWrite(FILE, JSON.stringify(data, null, 2) + "\n");
}
function disable(id, flags) { if (!id) throw new Error("비활성화할 id가 필요합니다."); const data = load(); const person = data.people.find((p) => p.id === id); if (!person) throw new Error(`등록된 id가 없습니다: ${id}`); const plan = { action: "disable", dryRun: !flags.apply, id, previousActive: person.active !== false, nextActive: false }; output(plan); if (!flags.apply) { console.log("dry-run: 실제 저장은 --apply를 명시해야 합니다."); return; } if (!flags.confirm) throw new Error("실제 저장에는 --confirm도 필요합니다."); person.active = false; person.disabledAt = new Date().toISOString(); atomicWrite(FILE, JSON.stringify(data, null, 2) + "\n"); }
const { command, positional, flags } = parse();
try { if (command === "list") list(); else if (command === "validate") validate(); else if (command === "add") add(flags); else if (command === "disable") disable(positional[0], flags); else throw new Error("list | validate | add --id --name --role | disable <id>"); } catch (error) { console.error(error.message); process.exitCode = 1; }
