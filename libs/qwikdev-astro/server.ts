import { jsx } from "@builder.io/qwik";
import { getQwikLoaderScript, renderToString } from "@builder.io/qwik/server";
import { manifest } from "@qwik-client-manifest";
import { isDev } from "@builder.io/qwik/build";
import type { QwikManifest, SymbolMapperFn } from "@builder.io/qwik/optimizer";
import type { SSRResult } from "astro";
import { PrefetchGraph, PrefetchServiceWorker } from "@builder.io/qwik";

const qwikLoaderAdded = new WeakMap<SSRResult, boolean>();

type RendererContext = {
  result: SSRResult;
};

async function check(
  this: RendererContext,
  Component: any,
  props: Record<string, any>,
  slotted: any
) {
  try {
    if (typeof Component !== "function") return false;

    if (Component.name !== "QwikComponent") {
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error in check function of @qwikdev/astro: ", error);
  }
}

export async function renderToStaticMarkup(
  this: RendererContext,
  Component: any,
  props: Record<string, any>,
  slotted: any
) {
  try {
    if (Component.name !== "QwikComponent") {
      return;
    }

    const slots: { [key: string]: any } = {};
    let defaultSlot;

    // getting functions from index causes a rollup issue.
    for (const [key, value] of Object.entries(slotted)) {
      const jsxElement = jsx("span", {
        dangerouslySetInnerHTML: String(value),
        style: "display: contents",
        ...(key !== "default" && { "q:slot": key }),
        "q:key": Math.random().toString(26).split(".").pop(),
      });

      if (key === "default") {
        defaultSlot = jsxElement;
      } else {
        slots[key] = jsxElement;
      }
    }

    const app = jsx(Component, {
      ...props,
      children: [defaultSlot, ...Object.values(slots)],
    });

    const symbolMapper: SymbolMapperFn = (symbolName: string) => {
      return [
        symbolName,
        `/${process.env.SRC_DIR}/` + symbolName.toLocaleLowerCase() + ".js",
      ];
    };

    const shouldAddQwikLoader = !qwikLoaderAdded.has(this.result);
    if (shouldAddQwikLoader) {
      qwikLoaderAdded.set(this.result, true);
    }

    const base = props["q:base"] || process.env.Q_BASE;

    // TODO: `jsx` must correctly be imported.
    // Currently the vite loads `core.mjs` and `core.prod.mjs` at the same time and this causes issues.
    // WORKAROUND: ensure that `npm postinstall` is run to patch the `@builder.io/qwik/package.json` file.
    const result = await renderToString(app, {
      base,
      containerTagName: "div",
      containerAttributes: { style: "display: contents" },
      manifest: isDev ? ({} as QwikManifest) : manifest,
      symbolMapper: manifest ? undefined : symbolMapper,
      qwikLoader: { include: "never" },
    });

    const PREFETCH_GRAPH_CODE = `((qc, c, q, v, b, h) => {
      b = qc.getAttribute("q:base");
      h = qc.getAttribute("q:manifest-hash");
      c.register("/qwik-prefetch-service-worker.js", {
        scope: "/"
      }).then((sw, onReady) => {
        onReady = () => q.forEach(q.push = (v2) => sw.active.postMessage(v2));
        sw.installing ? sw.installing.addEventListener("statechange", (e) => e.target.state == "activated" && onReady()) : onReady();
      });
      v && q.push([
        "verbose"
      ]);
      document.addEventListener("qprefetch", (e) => e.detail.bundles && q.push([
        "prefetch",
          b,
          ...e.detail.bundles
        ]));
      })(
    document.currentScript.closest('[q\\\\:container]'),
    navigator.serviceWorker,
    window.qwikPrefetchSW||(window.qwikPrefetchSW=[]),
    true
    )`;

    const PREFETCH_CODE = `((qc, q, b, h, u) => {
      q.push([
        "graph-url", 
        b || qc.getAttribute("q:base"),
        u || \`q-bundle-graph-\${h || qc.getAttribute("q:manifest-hash")}.json\`
       ]);
    })(
     document.currentScript.closest('[q\\\\:container]'),
     window.qwikPrefetchSW||(window.qwikPrefetchSW=[]),
    )`;

    /*
      TODO: find a way to put this in the HTML Head. Potential tradeoff: use injectScript
    */
    /* scripts we need on first component vs. each */
    const { html } = result;
    let scripts = `
      <script qwik-prefetch-service-worker>
      ${PREFETCH_GRAPH_CODE}
      </script>
    `;

    if (shouldAddQwikLoader) {
      scripts = `
        <script qwik-loader>
          ${getQwikLoaderScript()}
        </script>
        <script qwik-prefetch-bundle-graph>
          ${PREFETCH_CODE}
        </script>
      ${scripts}`;
    }

    // Find the closing tag of the div with the `q:container` attribute
    const closingContainerTag = html.lastIndexOf("</div>");

    // Insert the scripts before the closing tag
    const htmlWithScripts = `${html.substring(
      0,
      closingContainerTag
    )}${scripts}${html.substring(closingContainerTag)}`;

    return {
      ...result,
      html: htmlWithScripts,
    };
  } catch (error) {
    console.error(
      "Error in renderToStaticMarkup function of @qwikdev/astro: ",
      error
    );
    throw error;
  }
}

export default {
  renderToStaticMarkup,
  supportsAstroStaticSlot: true,
  check,
};
