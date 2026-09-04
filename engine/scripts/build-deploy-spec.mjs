// Builds a Lightsail deployment spec from the CURRENTLY RUNNING deployment,
// changing only the image tag. Writes two files the AWS CLI can consume.
//
// Why derive from the running deployment rather than hand-write a spec: the
// live containers carry environment (DATABASE_URL, Clerk keys,
// INTERNAL_SERVICE_SECRET) that exists nowhere in this repo. A hand-written
// spec silently drops all of it and the service comes back up broken. This
// copies the running spec verbatim and swaps one field.
//
// Usage:
//   node scripts/build-deploy-spec.mjs <services.json> <service-name> <image-ref>

import { readFileSync, writeFileSync } from "node:fs";

const [, , servicesJson, serviceName, imageRef] = process.argv;
if (!servicesJson || !serviceName || !imageRef) {
  console.error("usage: build-deploy-spec.mjs <services.json> <service-name> <image-ref>");
  process.exit(2);
}

const doc = JSON.parse(readFileSync(servicesJson, "utf8"));
const svc = doc.containerServices.find((s) => s.containerServiceName === serviceName);
if (!svc) {
  console.error(`service ${serviceName} not found`);
  process.exit(1);
}

const cur = svc.currentDeployment;
const containers = {};
for (const [name, c] of Object.entries(cur.containers)) {
  containers[name] = { ...c, image: imageRef };
}

// publicEndpoint comes back with fields the create call rejects; keep only the
// three it accepts.
let endpoint = null;
if (cur.publicEndpoint) {
  const pe = cur.publicEndpoint;
  endpoint = { containerName: pe.containerName, containerPort: pe.containerPort };
  if (pe.healthCheck) endpoint.healthCheck = pe.healthCheck;
}

writeFileSync("/tmp/containers.json", JSON.stringify(containers));
if (endpoint) writeFileSync("/tmp/endpoint.json", JSON.stringify(endpoint));

console.log("service:        ", serviceName);
console.log("current version:", cur.version);
console.log("current image:  ", Object.values(cur.containers).map((c) => c.image).join(", "));
console.log("new image:      ", imageRef);
console.log("containers:     ", Object.keys(containers).join(", "));
console.log("env keys kept:  ", Object.values(containers).map((c) => Object.keys(c.environment ?? {}).length).join(", "));
console.log("endpoint:       ", endpoint ? `${endpoint.containerName}:${endpoint.containerPort}` : "(none)");
