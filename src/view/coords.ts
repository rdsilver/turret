/**
 * Sim (meters, y down) <-> world pixels. The Phaser camera works in world
 * pixels; sim y-down already matches screen orientation, so it's a pure scale.
 */
import { PPM } from '../config/constants';

export const toPx = (m: number): number => m * PPM;
export const toM = (px: number): number => px / PPM;
