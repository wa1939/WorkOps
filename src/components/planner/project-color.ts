export type ProjectColor = {
    dotColor: string;
};

export function projectColor(projectName: string | null): ProjectColor {
    const source = projectName?.trim() || "Unassigned";
    let hash = 0;
    for (let index = 0; index < source.length; index += 1) {
        hash = (hash * 31 + source.charCodeAt(index)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return { dotColor: `hsl(${hue} 65% 48%)` };
}
