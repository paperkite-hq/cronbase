import { defineConfig } from "vitepress";

export default defineConfig({
	title: "cronbase",
	description: "Beautiful self-hosted cron job manager with web dashboard",
	base: "/cronbase/",
	ignoreDeadLinks: [/^http:\/\/localhost/],
	head: [["link", { rel: "icon", href: "/cronbase/favicon.ico" }]],
	themeConfig: {
		logo: "/logo.png",
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
					{ text: "Raspberry Pi", link: "/guide/raspberry-pi" },
					{ text: "Kubernetes", link: "/guide/kubernetes" },
					{ text: "Proxmox", link: "/guide/proxmox" },
					{ text: "Migration from crontab", link: "/guide/migration" },
					{ text: "Comparison", link: "/guide/comparison" },
					{ text: "Examples", link: "/guide/examples" },
				{ text: "FAQ", link: "/guide/faq" },
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
