import { exec } from "node:child_process";
import { readFile } from "fs/promises";

const info = JSON.parse(
  await readFile(new URL("./package.json", import.meta.url)),
);

const bucketName = "sa-editorial-webhosting";
const path = `/2026/${info.name}`;

exec(
  `aws s3 sync dist/ s3://${bucketName}${path} --cache-control max-age=300,s-maxage=86400`,
);
exec(
  `aws cloudfront create-invalidation --distribution-id E2RHRFTQWI2N09 --paths ${path}/*`,
);

console.log(`\nhttps://editorial.aftenbladet.no${path}`);
