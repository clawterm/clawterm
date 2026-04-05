/** Runtime project — groups a set of tab IDs into an independent workspace (#401) */
export interface Project {
  id: string;
  name: string;
  tabIds: string[];
  activeTabId: string | null;
}

let projectCounter = 0;

export function createProject(name?: string): Project {
  projectCounter++;
  return {
    id: `project-${projectCounter}`,
    name: name || "Project",
    tabIds: [],
    activeTabId: null,
  };
}
