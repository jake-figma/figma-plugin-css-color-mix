console.clear();

const CLIENT_STORAGE_KEY = "css-color-mix";
const SHAPE_HEIGHT = 50;
const SHAPE_WIDTH = 500;
const WINDOW_HEIGHT = 300;
const WINDOW_WIDTH_SMALL = 240;
const WINDOW_WIDTH_LARGE = 480;

initialize();

async function initialize() {
  const settings = await clientStorageRetrieveSettings();
  figma.showUI(__html__, {
    height: WINDOW_HEIGHT,
    width:
      settings && settings.preview === false
        ? WINDOW_WIDTH_SMALL
        : WINDOW_WIDTH_LARGE,
    themeColors: true,
  });

  figma.ui.onmessage = async (message) => {
    if (message.type === "RESIZE") {
      figma.ui.resize(message.width, message.height);
    } else if (message.type === "SETTINGS") {
      clientStorageSaveSettings(message.settings);
    } else if (message.type === "GRADIENT" || message.type === "FILL") {
      actionFillShapeWithColorOrGradient(message);
    } else if (message.type === "SWATCHES") {
      actionCreateSwatches(message);
    } else if (message.type === "VARIABLES") {
      actionCreateVariables(message);
    } else {
      console.log(message);
    }
  };

  figma.on("selectionchange", async () => {
    const fills = await getFillsFromCurrentSelection();
    if (fills.length) {
      figma.ui.postMessage({ type: "FILLS", fills });
    }
  });

  let collections = await getLocalVariableCollections();
  setInterval(async () => {
    const latestCollections = await getLocalVariableCollections();
    if (variableCollectionsHaveChanged(collections, latestCollections)) {
      collections = latestCollections;
      figma.ui.postMessage({ type: "COLLECTIONS", collections });
    }
  }, 1000);

  const fills = await getFillsFromCurrentSelection();
  figma.ui.postMessage({ type: "INITIALIZE", collections, fills, settings });
}

async function actionCreateSwatches({ payload }) {
  const { space, colorA, colorB, colors } = payload;
  const frame = figma.createFrame();
  frame.layoutMode = "HORIZONTAL";
  frame.resize(SHAPE_WIDTH, SHAPE_HEIGHT);
  frame.fills = [];
  frame.name = `color-mix(in ${space}, ${colorA}, ${colorB})`;

  const width = (1 / colors.length) * frame.width;
  colors.forEach(({ rgb, colorA, colorB, space }, i) => {
    const rect = figma.createRectangle();
    rect.resize(width, frame.height);
    rect.layoutGrow = 1;
    rect.name = `color-mix(in ${space}, ${colorA}, ${colorB} ${
      Math.round((i / (colors.length - 1)) * 100 * 100) / 100
    }%)`;
    rect.fills = [figmaSolidFromColor(rgb)];
    frame.appendChild(rect);
  });
  selectAndFocusViewportOnNode(frame);
  figma.notify("Generated swatches!");
}

async function actionCreateVariables({ payload, collection }) {
  const { colors } = payload;
  const variableCollection =
    collection === "__CREATE_NEW_COLLECTION__"
      ? figma.variables.createVariableCollection("CSS color-mix()")
      : await figma.variables.getVariableCollectionByIdAsync(collection);

  if (!variableCollection) {
    figma.notify(`No collection with id "${collection}"`, {
      error: true,
    });
    return;
  }

  try {
    colors.forEach(({ rgb, colorA, colorB, space }, i) => {
      const ratio = (i / (colors.length - 1)) * 100;
      const variable = figma.variables.createVariable(
        `${colorA.replace("#", "")}-${colorB.replace(
          "#",
          ""
        )}/in ${space}/${Math.round(ratio * 10)}`,
        variableCollection,
        "COLOR"
      );
      variable.description = relevantCSSForType(
        "FILL",
        space,
        colorA,
        colorB,
        ratio
      );
      variable.setVariableCodeSyntax("WEB", variable.description);
      variable.setValueForMode(
        variableCollection.defaultModeId,
        figmaRGBFromRGB(rgb)
      );
    });
    figma.notify(`Created ${colors.length} variables!`);
  } catch (e) {
    figma.notify(`Error: ${e.message}`, { error: true });
  }
}

async function actionFillShapeWithColorOrGradient({ type, payload }) {
  const { space, colorA, colorB, ratio, colors, color } = payload;
  const shapeFromSelection = await getShapeForFillsFromSelection();
  const shape = shapeFromSelection || figma.createFrame();
  const newShape = !shapeFromSelection;
  if (newShape) {
    shape.resize(SHAPE_WIDTH, SHAPE_HEIGHT);
  }

  if (newShape || nodeCanBeRenamedSafely(shape)) {
    shape.name = relevantCSSForType(type, space, colorA, colorB, ratio);
  }

  shape.fills = [
    type === "GRADIENT"
      ? figmaGradientFromColors(colors)
      : figmaSolidFromColor(color),
  ];
  figma.notify(`Filled with ${type.toLowerCase()}!`);
  if (newShape) {
    selectAndFocusViewportOnNode(shape);
  }
}

async function clientStorageRetrieveSettings() {
  return await figma.clientStorage.getAsync(CLIENT_STORAGE_KEY);
}

async function clientStorageSaveSettings(args) {
  return await figma.clientStorage.setAsync(CLIENT_STORAGE_KEY, args);
}

function figmaGradientFromColors(colors) {
  return {
    type: "GRADIENT_LINEAR",
    gradientTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    gradientStops: colors.map(({ rgb }, i) => ({
      position: i / (colors.length - 1),
      color: Object.assign(figmaRGBFromRGB(rgb), { a: 1 }),
    })),
  };
}

function figmaRGBFromRGB({ r, g, b }) {
  return {
    r: r / 255,
    g: g / 255,
    b: b / 255,
  };
}

function figmaSolidFromColor(color) {
  return {
    type: "SOLID",
    color: figmaRGBFromRGB(color),
    opacity: 1,
  };
}

async function getFillsFromCurrentSelection() {
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

async function getShapeForFillsFromSelection() {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    return;
  }
  const node = selection[0];
  if (!("fills" in node)) {
    return;
  }
  if (!("children" in node)) {
    return;
  }
  if (node.children.length !== 0) {
    return;
  }
  return node;
}

async function getLocalVariableCollections() {
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

function nodeCanBeRenamedSafely(node) {
  if (node.type !== "FRAME") {
    return false;
  }
  return (
    node.name.startsWith("linear-gradient(") ||
    node.name.startsWith("color-mix(")
  );
}

function relevantCSSForType(type, space, colorA, colorB, ratio) {
  if (type === "GRADIENT") {
    return `linear-gradient(90deg in ${space}, ${colorA}, ${colorB})`;
  }
  ratio = ratio === undefined ? "" : ` ${ratio}%`;
  return `color-mix(in ${space}, ${colorA}, ${colorB}${ratio})`;
}

function selectAndFocusViewportOnNode(node) {
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView(figma.currentPage.selection);
  figma.viewport.zoom *= 0.6;
}

function variableCollectionsHaveChanged(collections1, collections2) {
  return (
    collections1.map(({ key }) => key).join("-") !==
    collections2.map(({ key }) => key).join("-")
  );
}
