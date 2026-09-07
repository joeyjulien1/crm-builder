import { describe, expect, it } from "vitest";
import { checkScreenSource } from "@/lib/config/screen-source";

/**
 * The failure that actually happened: a screen whose error branch opened
 * <Page> and never closed it, twenty lines into an otherwise fine component. It
 * was stored, and the first person to find out was the user.
 */
describe("checking a screen before it is stored", () => {
  it("catches JSX the model left unbalanced, and says which line", () => {
    const problem = checkScreenSource(`export default function Screen() {
  const { records, loading, error } = useRecords("deal", { limit: 10 });
  if (loading) return <Page><Loading/></Page>;
  if (error) return <Page><ErrorNote>{error}</ErrorNote>;
  return <Page>{records.length}</Page>;
}`);

    expect(problem).toBeTruthy();
    expect(problem).toMatch(/line 4/);
    expect(problem).toMatch(/closed/i);
  });

  it("passes a screen that parses", () => {
    expect(
      checkScreenSource(`export default function Screen() {
  const { records } = useRecords("deal", { limit: 10 });
  return <Page><DataTable object={objects.deal} records={records} columns={["name"]}/></Page>;
}`),
    ).toBeUndefined();
  });

  it("still refuses what a screen may not contain", () => {
    expect(checkScreenSource(`import x from "y"; export default function Screen() { return null; }`)).toMatch(
      /no imports/,
    );
  });

  it("refuses source with no component in it", () => {
    expect(checkScreenSource(`const rows = [1, 2, 3];`)).toMatch(/no component/i);
  });
});
