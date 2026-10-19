// 다년 커리어 한 번 돌리기 (worker_threads). 데이터는 한 번만 읽고, {조절값, 시드, 해 수}를 받아 측정값을 돌려준다
import { parentPort } from "node:worker_threads";
import { careerRun, type CareerData } from "./career/metrics.ts";
import type { CareerParams } from "./career/params.ts";
import { loadAcademy, loadParams, loadRaw, loadStart2025, loadUniverse, loadWorldTargets } from "./data.ts";

const data: CareerData = { ...loadRaw(), academy: loadAcademy(), params: loadParams(), world: loadWorldTargets(), start: loadStart2025(), base: loadUniverse() };

parentPort!.on("message", (job: { id: number; cp: CareerParams; seed: number; years: number }) => {
  parentPort!.postMessage({ id: job.id, m: careerRun(data, job.cp, job.seed, job.years) });
});
