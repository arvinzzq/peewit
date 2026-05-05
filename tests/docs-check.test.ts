import { describe, expect, test } from "vitest";
import {
  findBilingualHeadingIssues,
  findMarkdownLinkIssues,
  findMissingModuleDocs,
  findMissingSourceHeaders
} from "../scripts/check-docs.js";

describe("documentation checks", () => {
  test("finds no broken markdown links in docs", () => {
    expect(findMarkdownLinkIssues("docs")).toEqual([]);
  });

  test("finds no bilingual heading count mismatches in docs", () => {
    expect(findBilingualHeadingIssues("docs")).toEqual([]);
  });

  test("finds no missing module documentation guides", () => {
    expect(findMissingModuleDocs(".")).toEqual([]);
  });

  test("finds no missing source file headers", () => {
    expect(findMissingSourceHeaders(".")).toEqual([]);
  });
});
