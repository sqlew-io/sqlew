/**
 * `project` MCP tool - resolve and inspect projects for tool-call-level
 * project targeting (desktop AI agents).
 *
 * Actions: current | resolve | list | validate | help | example
 */

import { getHelpLoader } from '../../help-loader.js';
import { trackAndReturnHelp } from '../../utils/help-tracking.js';
import { projectCurrent } from './actions/current.js';
import { projectResolve } from './actions/resolve.js';
import { projectList } from './actions/list.js';
import { projectValidate } from './actions/validate.js';

export { projectCurrent, projectResolve, projectList, projectValidate };

/** Build project tool documentation from help-data/project.toml. */
export async function projectHelp(): Promise<unknown> {
  const loader = await getHelpLoader();
  const tool = loader.getTool('project');
  if (!tool) {
    return { error: 'Project help not found' };
  }
  const helpContent = {
    tool: tool.name,
    description: tool.description,
    actions: tool.actions.map((a) => ({
      name: a.name,
      description: a.description,
      params: a.params,
    })),
  };
  trackAndReturnHelp('project', 'help', JSON.stringify(helpContent));
  return helpContent;
}

/** Build project tool examples from help-data/project.toml. */
export async function projectExample(): Promise<unknown> {
  const loader = await getHelpLoader();
  const tool = loader.getTool('project');
  if (!tool) {
    return { error: 'Project examples not found' };
  }
  const exampleContent = {
    tool: tool.name,
    examples: tool.actions.flatMap((a) =>
      a.examples.map((ex) => ({
        action: a.name,
        ...ex,
      }))
    ),
  };
  trackAndReturnHelp('project', 'example', JSON.stringify(exampleContent));
  return exampleContent;
}
