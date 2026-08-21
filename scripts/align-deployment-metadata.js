import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = path.resolve("site", "deployment.json");

export function alignDeploymentMetadata(commit, file = DEFAULT_FILE) {
  if (!/^[0-9a-f]{7,64}$/i.test(String(commit || ""))) {
    throw new Error("배포 커밋 SHA가 올바르지 않습니다.");
  }
  if (!fs.existsSync(file)) throw new Error(`배포 매니페스트가 없습니다: ${file}`);

  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!payload || payload.version !== 1) throw new Error("지원하지 않는 배포 매니페스트입니다.");
  payload.sourceCommit = String(commit);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) {
  const payload = alignDeploymentMetadata(process.argv[2]);
  console.log(`deployment metadata aligned: ${payload.sourceCommit}`);
}
