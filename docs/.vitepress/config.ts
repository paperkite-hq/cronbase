import { defineConfig } from "vitepress";

export default defineConfig({
	title: "cronbase",
	description: "Beautiful self-hosted cron job manager with web dashboard",
	base: "/cronbase/",
	themeConfig: {
		nav: [
			{ text: "Guide", link: "/guide/getting-started" },
			{ text: "Reference", link: "/reference/cli" },
			{ text: "GitHub", link: "https://github.com/paperkite-hq/cronbase" },
		],
		sidebar: [
			{
				text: "Guide",
				items: [
					{ text: "Getting Started", link: "/guide/getting-started" },
					{ text: "Configuration", link: "/guide/configuration" },
					{ text: "Alerting", link: "/guide/alerting" },
					{ text: "Docker", link: "/guide/docker" },
					{ text: "Migration from crontab", link: "/guide/migration" },
					{ text: "Comparison", link: "/guide/comparison" },
					{ text: "Examples", link: "/guide/examples" },
				],
			},
			{
				text: "Reference",
				items: [
					{ text: "CLI", link: "/reference/cli" },
					{ text: "REST API", link: "/reference/api" },
					{ text: "TypeScript API", link: "/reference/typescript" },
					{ text: "Cron Expressions", link: "/reference/cron" },
					{ text: "Config File", link: "/reference/config" },
				],
			},
		],
		socialLinks: [{ icon: "github", link: "https://github.com/paperkite-hq/cronbase" }],
		footer: {
			message: "Released under the AGPL-3.0 License.",
		},
	},
});
