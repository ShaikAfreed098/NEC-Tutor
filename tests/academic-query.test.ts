import test from "node:test";
import assert from "node:assert/strict";
import { academicQuery } from "../src/lib/academic-query";

test("exam dates search the shared academic notices across a selected unit", () => {
  const plan = academicQuery("When is the Java examination?", "programming", 4);
  assert.equal(plan.subject, "academic");
  assert.equal(plan.unit, null);
  assert.equal(plan.selectedCourse, "Java");
});
test("a general exam question carries the student's chosen course", () => {
  assert.equal(academicQuery("What is my exam date?", "chemistry", 3).selectedCourse, "Chemistry");
  assert.equal(academicQuery("Give Java and Chemistry exam dates", "programming", 4).selectedCourse, "");
});
test("exam revision questions still retrieve course concepts", () => {
  const plan = academicQuery("Explain inheritance for my Java exam", "java", 2);
  assert.equal(plan.official, false);
  assert.equal(plan.subject, "java");
  assert.equal(plan.unit, 2);
});
test("short subject follow-ups retain the timetable context", () => {
  const plan = academicQuery("And Chemistry?", "java", 4, "When is the Java examination?");
  assert.equal(plan.subject, "academic");
  assert.equal(plan.unit, null);
  assert.equal(plan.selectedCourse, "Chemistry");
  assert.equal(academicQuery("Explain pointers with an example", "programming", 4, "When is the Java examination?").official, false);
});
