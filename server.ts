import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { StitchClient } from './stitch-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RESOURCE_URI = 'ui://stitch-design/app.html';

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ type: 'error', data: { message } }) }],
    isError: true,
  };
}

export const createServer = () => {
  const server = new McpServer({
    name: 'stitch-design',
    version: '1.0.0',
  });

  const stitch = new StitchClient();

  // Tool 1: List Projects
  registerAppTool(
    server,
    'list-projects',
    {
      description: 'List all Stitch design projects. Shows a visual grid of projects with names and metadata.',
      inputSchema: {
        filter: z.string().optional().describe('Filter: "view=owned" (default) or "view=shared"'),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async (args) => {
      try {
        const projects = await stitch.listProjects(args.filter);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'list_projects',
                data: { projects },
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // Tool 2: List Screens
  registerAppTool(
    server,
    'list-screens',
    {
      description: 'List all screens in a Stitch project. Shows a thumbnail grid of screen designs.',
      inputSchema: {
        projectId: z.string().describe('The Stitch project ID'),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async (args) => {
      try {
        const screens = await stitch.listScreens(args.projectId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'list_screens',
                data: { projectId: args.projectId, screens },
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // Tool 3: Design Viewer
  registerAppTool(
    server,
    'design-viewer',
    {
      description: 'View a Stitch screen design with image preview, HTML/CSS code, and extracted design tokens (colors, fonts, spacing).',
      inputSchema: {
        projectId: z.string().describe('The Stitch project ID'),
        screenId: z.string().describe('The screen ID to view'),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async (args) => {
      try {
        const [screen, imageData, codeData, designContext] = await Promise.all([
          stitch.getScreen(args.projectId, args.screenId),
          stitch.fetchScreenImage(args.projectId, args.screenId),
          stitch.fetchScreenCode(args.projectId, args.screenId),
          stitch.extractDesignContext(args.projectId, args.screenId),
        ]);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'design_viewer',
                data: { screen, imageData, codeData, designContext },
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // Tool 4: Generate Design
  registerAppTool(
    server,
    'generate-design',
    {
      description: 'Generate a new screen design in a Google Stitch project using AI. Creates the design in Stitch and returns a preview with code. Use this tool when the user wants to generate, create, or design a new screen in Stitch.',
      inputSchema: {
        projectId: z.string().describe('The Stitch project ID to generate the screen in'),
        prompt: z.string().describe('Text description of the desired screen design'),
        deviceType: z.enum(['MOBILE', 'DESKTOP', 'TABLET']).optional().describe('Target device type (default: MOBILE)'),
        modelId: z.enum(['GEMINI_3_PRO', 'GEMINI_3_FLASH']).optional().describe('AI model to use (default: GEMINI_3_FLASH)'),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async (args) => {
      try {
        const result = await stitch.generateScreenFromText({
          projectId: args.projectId,
          prompt: args.prompt,
          deviceType: args.deviceType,
          modelId: args.modelId,
        });

        // Extract suggestions from output components if present
        const suggestions: string[] = [];
        if (result.outputComponents) {
          for (const component of result.outputComponents) {
            if (component.suggestions) {
              suggestions.push(...component.suggestions);
            }
          }
        }

        // Fetch image and code for the generated screen
        let imageData = '';
        let codeData = { html: '', css: '' };
        if (result.screen?.name) {
          const parts = result.screen.name.split('/');
          const screenId = parts[parts.length - 1] || '';
          try {
            [imageData, codeData] = await Promise.all([
              stitch.fetchScreenImage(args.projectId, screenId),
              stitch.fetchScreenCode(args.projectId, screenId),
            ]);
          } catch {
            // Screen may not be ready yet, image/code are optional
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'generate_design',
                data: {
                  screen: result.screen,
                  imageData,
                  codeData,
                  suggestions: suggestions.length > 0 ? suggestions : undefined,
                  prompt: args.prompt,
                },
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // Tool 5: Extract Design Context
  registerAppTool(
    server,
    'extract-design-context',
    {
      description: 'Extract design tokens (colors, fonts, spacing, layouts) from a Stitch screen. Useful for maintaining design consistency across screens.',
      inputSchema: {
        projectId: z.string().describe('The Stitch project ID'),
        screenId: z.string().describe('The screen ID to analyze'),
      },
      _meta: {
        ui: { resourceUri: RESOURCE_URI },
      },
    },
    async (args) => {
      try {
        const designContext = await stitch.extractDesignContext(args.projectId, args.screenId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'design_context',
                data: designContext,
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // Register shared UI resource with CSP for external images
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: 'text/html;profile=mcp-app' },
    async () => {
      try {
        const htmlPath = join(__dirname, 'mcp-app.html');
        const html = readFileSync(htmlPath, 'utf-8');

        return {
          contents: [
            {
              uri: RESOURCE_URI,
              mimeType: 'text/html;profile=mcp-app',
              text: html,
              _meta: {
                ui: {
                  csp: {
                    resourceDomains: [
                      'https://lh3.googleusercontent.com',
                      'https://storage.googleapis.com',
                      'https://contribution.usercontent.google.com',
                    ],
                  },
                },
              },
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to load UI: ${error}`);
      }
    }
  );

  return server;
};
