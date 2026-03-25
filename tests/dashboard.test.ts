import { describe, expect, it } from "bun:test";
import { getDashboardHtml } from "../src/dashboard";

describe("getDashboardHtml", () => {
	it("returns HTML string without token injection", () => {
		const html = getDashboardHtml();
		expect(typeof html).toBe("string");
		expect(html.length).toBeGreaterThan(1000);
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("const API_TOKEN = null;");
	});

	it("injects token when provided", () => {
		const token = "mytoken123";
		const html = getDashboardHtml(token);
		expect(html).toContain(`const API_TOKEN = "mytoken123";`);
		expect(html).not.toContain("const API_TOKEN = null;");
	});

	it("removes the null placeholder when token is injected", () => {
		const html = getDashboardHtml("sometoken");
		expect(html).not.toContain("const API_TOKEN = null;");
	});

	it("uses JSON.stringify for token escaping — handles quotes", () => {
		// Token containing double quotes should be safely escaped
		const token = 'tok"en';
		const html = getDashboardHtml(token);
		// JSON.stringify produces "tok\"en" which is safe in a JS context
		expect(html).toContain('const API_TOKEN = "tok\\"en";');
		expect(html).not.toContain("const API_TOKEN = null;");
	});

	it("escapes </script> in token to prevent script tag breakout", () => {
		// A token containing </script> without escaping would break out of the <script> block,
		// allowing XSS. We replace </ with <\/ to prevent this.
		const token = "</script><script>alert(1)</script>";
		const html = getDashboardHtml(token);
		// The raw </script> sequence must not appear in the output
		expect(html).not.toContain("</script><script>alert(1)");
		// The escaped form should be present
		expect(html).toContain("<\\/script>");
		expect(html).not.toContain("const API_TOKEN = null;");
	});

	it("without token, API_TOKEN remains null", () => {
		const html = getDashboardHtml(undefined);
		expect(html).toContain("const API_TOKEN = null;");
	});

	it("returns a complete HTML document with required structure", () => {
		const html = getDashboardHtml();
		expect(html).toContain("<html");
		expect(html).toContain("</html>");
		expect(html).toContain("<head>");
		expect(html).toContain("<body");
		expect(html).toContain("cronbase");
	});

	it("two calls with same token return identical output", () => {
		const html1 = getDashboardHtml("token-abc");
		const html2 = getDashboardHtml("token-abc");
		expect(html1).toBe(html2);
	});
});
