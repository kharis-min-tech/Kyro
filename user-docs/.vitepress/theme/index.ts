import DefaultTheme from "vitepress/theme";
import Shot from "./Shot.vue";
import Icon from "./Icon.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("Shot", Shot);
    app.component("Icon", Icon);
  },
};
