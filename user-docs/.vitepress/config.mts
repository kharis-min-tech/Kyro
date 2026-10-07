import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Kyro",
  description: "How to use Kyro — AI-powered attendance, seating and venue intelligence for Kharis Church.",
  lang: "en-GB",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", href: "/favicon.ico" }],
    ["link", { rel: "apple-touch-icon", href: "/logo.png" }],
    ["meta", { name: "theme-color", content: "#4f46e5" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    ["link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" }],
  ],
  themeConfig: {
    logo: { src: "/logo.png", alt: "Kyro" },
    siteTitle: "Kyro",
    nav: [
      { text: "Get started", link: "/getting-started/what-is-kyro" },
      { text: "Pages", link: "/pages/ai-count" },
      { text: "Guides", link: "/guides/sunday-checklist" },
      { text: "Help", link: "/help/troubleshooting" },
      { text: "Open Kyro", link: "https://kyro.kharischurch.com" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "What is Kyro?", link: "/getting-started/what-is-kyro" },
          { text: "Video tour", link: "/getting-started/video-tour" },
          { text: "Signing in", link: "/getting-started/signing-in" },
          { text: "Finding your way around", link: "/getting-started/navigation" },
          { text: "Roles & access", link: "/getting-started/roles" },
          { text: "Install on your phone", link: "/getting-started/install" },
        ],
      },
      {
        text: "Pages",
        items: [
          { text: "AI Count", link: "/pages/ai-count" },
          { text: "Manual Count", link: "/pages/manual-count" },
          { text: "Live Cameras", link: "/pages/live-cameras" },
          { text: "Seat Map", link: "/pages/seat-map" },
          { text: "Cameras", link: "/pages/cameras" },
          { text: "Rota", link: "/pages/rota" },
          { text: "Sessions", link: "/pages/sessions" },
          { text: "Analytics", link: "/pages/analytics" },
          { text: "Seat Editor", link: "/pages/seat-editor" },
          { text: "Integrations", link: "/pages/integrations" },
          { text: "Notifications", link: "/pages/notifications" },
          { text: "Users", link: "/pages/users" },
        ],
      },
      {
        text: "Guides",
        items: [
          { text: "Sunday service checklist", link: "/guides/sunday-checklist" },
          { text: "Getting alerts on your phone", link: "/guides/phone-alerts" },
          { text: "AI questions & seat alerts", link: "/guides/ai-questions" },
          { text: "Sending attendance to another system", link: "/guides/send-attendance" },
        ],
      },
      {
        text: "Help",
        items: [
          { text: "Troubleshooting & FAQ", link: "/help/troubleshooting" },
        ],
      },
    ],
    search: { provider: "local" },
    outline: { level: [2, 3], label: "On this page" },
    docFooter: { prev: "Previous", next: "Next" },
    lastUpdated: { text: "Last updated" },
    footer: { message: "Kyro: AI attendance & venue intelligence by Kharis Church" },
  },
});
