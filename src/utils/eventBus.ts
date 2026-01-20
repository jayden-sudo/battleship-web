export const ON_GAMEBOARD_UPDATE = "ON_GAMEBOARD_UPDATE";
export const ON_HASHCHAIN_UPDATE = "ON_HASHCHAIN_UPDATE";

export const emitGameboardUpdate = () => {
  const event = new CustomEvent(ON_GAMEBOARD_UPDATE, {});
  window.dispatchEvent(event);
};

export const emitHashChainUpdate = () => {
  const event = new CustomEvent(ON_HASHCHAIN_UPDATE, {});
  window.dispatchEvent(event);
};
