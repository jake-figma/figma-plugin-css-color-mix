console.clear();

const CLIENT_STORAGE_KEY = "css-color-mix";

start();

async function getCollections() {
  return (await figma.variables.getLocalVariableCollectionsAsync()).flatMap(
    (collection) => {
      if (collection.remote) {
        return [];
      }
      return [
        {
          id: collection.id,
          name: collection.name,
          key: collection.id + "-" + collection.name,
        },
      ];
    }
  );
}

async function start() {
  figma.showUI(__html__, { height: 240, width: 240 });

  let collections = await getCollections();
  setInterval(async () => {
    const collections2 = await getCollections();
    if (
      collections.map((collection) => collection.key).join("-") !==
      collections2.map((collection) => collection.key).join("-")
    ) {
      collections = collections2;
      figma.ui.postMessage({ type: "COLLECTIONS", collections });
    }
  }, 1000);
  const fills = getFills();
  const settings = await getSettings();
  figma.ui.postMessage({ type: "INITIALIZE", collections, fills, settings });
  figma.on("selectionchange", () => {
    const fills = getFills();
    if (fills.length) {
      figma.ui.postMessage({ type: "FILLS", fills });
    }
  });
}

async function getSettings() {
  return await figma.clientStorage.getAsync(CLIENT_STORAGE_KEY);
}

async function setSettings(args) {
  return await figma.clientStorage.setAsync(CLIENT_STORAGE_KEY, args);
}

function getFills() {
  const fills = [];
  if (figma.currentPage.selection.length === 2) {
    const fillSolidA = figma.currentPage.selection[0].fills.find(
      (fill) => fill.visible && fill.type === "SOLID"
    );
    const fillSolidB = figma.currentPage.selection[1].fills.find(
      (fill) => fill.visible && fill.type === "SOLID"
    );
    if (fillSolidA && fillSolidB) {
      fills.push(fillSolidA.color, fillSolidB.color);
    }
  }
  const node = figma.currentPage.selection[0];
  if (!fills.length && node) {
    const fillSolid = node.fills.find(
      (fill) => fill.visible && fill.type === "SOLID"
    );
    const fillGradient = node.fills.find(
      (fill) => fill.visible && fill.type.startsWith("GRADIENT")
    );
    if (fillGradient) {
      const stop1 = fillGradient.gradientStops[0];
      const stop2 =
        fillGradient.gradientStops[fillGradient.gradientStops.length - 1];
      if (stop1 && stop2) {
        fills.push(stop1.color, stop2.color);
      }
    }
    if (!fills.length && fillSolid) {
      fills.push(fillSolid.color);
    }
  }
  return fills;
}

const shapeHeight = 50;
const shapeWidth = 500;

figma.ui.onmessage = async (message) => {
  if (message.type === "RESIZE") {
    figma.ui.resize(message.width, message.height);
  } else if (message.type === "SETTINGS") {
    setSettings(message.settings);
  } else if (message.type === "GRADIENT" || message.type === "FILL") {
    let shape;
    let newShape = false;
    if (
      figma.currentPage.selection.length === 1 &&
      "fills" in figma.currentPage.selection[0] &&
      (!("children" in figma.currentPage.selection[0]) ||
        figma.currentPage.selection[0].children.length === 0)
    ) {
      shape = figma.currentPage.selection[0];
    } else {
      shape = figma.createRectangle();
      shape.resize(shapeWidth, shapeHeight);
      newShape = true;
    }
    if (
      newShape ||
      (shape.type === "RECTANGLE" &&
        (shape.name.startsWith("linear-gradient(") ||
          shape.name.startsWith("color-mix(")))
    ) {
      const { space, colorA, colorB, ratio } = message.payload;
      shape.name =
        message.type === "GRADIENT"
          ? `linear-gradient(90deg in ${space}, ${colorA}, ${colorB})`
          : `color-mix(in ${space}, ${colorA}, ${colorB} ${ratio}%)`;
    }
    shape.fills =
      message.type === "GRADIENT"
        ? [
            {
              type: "GRADIENT_LINEAR",
              gradientTransform: [
                [1, 0, 0],
                [0, 1, 0],
              ],
              gradientStops: message.payload.colors.map(({ rgb }, i) => ({
                position: i / (message.payload.colors.length - 1),
                color: { r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255, a: 1 },
              })),
            },
          ]
        : [
            {
              type: "SOLID",
              color: {
                r: message.payload.color.r / 255,
                g: message.payload.color.g / 255,
                b: message.payload.color.b / 255,
              },
            },
          ];
    if (newShape) {
      figma.currentPage.selection = [shape];
      figma.viewport.scrollAndZoomIntoView(figma.currentPage.selection);
      figma.viewport.zoom *= 0.6;
    }
  } else if (message.type === "SWATCHES") {
    const frame = figma.createFrame();
    frame.layoutMode = "HORIZONTAL";
    frame.resize(shapeWidth, shapeHeight);
    frame.fills = [];
    const { space, colorA, colorB } = message.payload;
    frame.name = `color-mix(in ${space}, ${colorA}, ${colorB})`;

    const width = (1 / message.payload.colors.length) * frame.width;
    message.payload.colors.forEach(({ rgb, colorA, colorB, space }, i) => {
      const rect = figma.createRectangle();
      rect.resize(width, frame.height);
      rect.layoutGrow = 1;
      rect.name = `color-mix(in ${space}, ${colorA}, ${colorB} ${
        Math.round((i / (message.payload.colors.length - 1)) * 100 * 100) / 100
      }%)`;
      rect.fills = [
        {
          type: "SOLID",
          color: { r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255 },
          opacity: 1,
        },
      ];
      frame.appendChild(rect);
    });
    figma.currentPage.selection = [frame];
    figma.viewport.scrollAndZoomIntoView(figma.currentPage.selection);
    figma.viewport.zoom *= 0.6;
  } else if (message.type === "VARIABLES") {
    const collection =
      message.collection === "__CREATE_NEW_COLLECTION__"
        ? figma.variables.createVariableCollection("CSS color-mix()")
        : await figma.variables.getVariableCollectionByIdAsync(
            message.collection
          );

    if (!collection) {
      figma.notify(`No collection with id "${message.collection}"`, {
        error: true,
      });
      return;
    }

    try {
      message.payload.colors.forEach(({ rgb, colorA, colorB, space }, i) => {
        const variable = figma.variables.createVariable(
          `${colorA.replace("#", "")}-${colorB.replace(
            "#",
            ""
          )}/in ${space}/${Math.round(
            (i / (message.payload.colors.length - 1)) * 1000
          )}`,
          collection,
          "COLOR"
        );
        variable.description = `color-mix(in ${space}, ${colorA}, ${colorB}, ${
          (i / (message.payload.colors.length - 1)) * 100
        }%)`;
        variable.setVariableCodeSyntax("WEB", variable.description);
        variable.setValueForMode(collection.defaultModeId, {
          r: rgb.r / 255,
          g: rgb.g / 255,
          b: rgb.b / 255,
        });
      });
    } catch (e) {
      figma.notify(e.message, { error: false });
    }
  } else {
    console.log(message);
  }
};
