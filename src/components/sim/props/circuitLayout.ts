/** Terminal positions of the circuit props (local coordinates), kept apart from the components for fast refresh. */

/** `PowerSupply`: red "+" and black "−" sockets on the front panel. */
export const PSU_PLUS: [number, number, number] = [0.25, 0.15, 0.33];
export const PSU_MINUS: [number, number, number] = [-0.25, 0.15, 0.33];

/** `Rheostat`: the left end of the winding and the right end of the slider rail. */
export const RHEO_LEFT: [number, number, number] = [-0.85, 0.12, 0.21];
export const RHEO_RIGHT: [number, number, number] = [0.85, 0.62, 0];
