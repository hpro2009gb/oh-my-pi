export interface AlphaShape {
	x: number;
}

export function alphaOne(a: number): number {
	return a + 1;
}

export const alphaConst = 42;

// Non-exported symbols must NOT appear in the outline.
function hiddenHelper(): void {}
