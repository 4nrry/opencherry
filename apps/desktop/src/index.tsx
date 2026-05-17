/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { ThemeProvider } from "./theme/context";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");
render(() => <ThemeProvider><App /></ThemeProvider>, root);
