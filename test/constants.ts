import { constants } from "ethers";

export const H = 3600;
export const DAY = 86400;
export const NUMBER_OF_DAYS = 7;
export const WEEK = NUMBER_OF_DAYS * DAY;
export const MAXTIME = 2 * 365 * DAY;

export const PRECISION_BASE = constants.WeiPerEther;
export const TOL = PRECISION_BASE.mul(120).div(WEEK);
