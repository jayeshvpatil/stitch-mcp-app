import { GoogleAuth } from 'google-auth-library';

const STITCH_API_BASE = 'https://stitch.googleapis.com/v1';

export interface StitchProject {
  name: string;
  title: string;
  createTime: string;
  updateTime: string;
}

interface FileReference {
  name: string;
  downloadUrl: string;
}

export interface StitchScreen {
  name: string;
  id?: string;
  title?: string;
  screenshot?: FileReference;
  htmlCode?: FileReference;
  cssCode?: FileReference;
  deviceType?: string;
  theme?: Record<string, unknown>;
  prompt?: string;
  width?: string;
  height?: string;
  screenType?: string;
  generatedBy?: string;
  createTime?: string;
  updateTime?: string;
}

export interface DesignElement {
  name: string;
  value: string;
  usage: string;
}

export interface DesignContext {
  colors: Array<{ name: string; hex: string; usage: string }>;
  fonts: Array<{ family: string; weight: string; size: string; usage: string }>;
  spacing: Array<{ name: string; value: string }>;
  layouts: Array<{ type: string; description: string }>;
}

export interface GenerateScreenOptions {
  projectId: string;
  prompt: string;
  deviceType?: 'MOBILE' | 'DESKTOP' | 'TABLET';
  modelId?: 'GEMINI_3_PRO' | 'GEMINI_3_FLASH';
}

export class StitchClient {
  private auth: GoogleAuth;
  private projectId: string;

  constructor() {
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    this.projectId = process.env['GOOGLE_CLOUD_PROJECT'] || '';
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const client = await this.auth.getClient();
    const token = await client.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token.token) {
      headers['Authorization'] = `Bearer ${token.token}`;
    }
    if (this.projectId) {
      headers['X-Goog-User-Project'] = this.projectId;
    }
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers = await this.getHeaders();
    const url = `${STITCH_API_BASE}${path}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Stitch API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async listProjects(filter?: string): Promise<StitchProject[]> {
    const params = new URLSearchParams();
    if (filter) {
      params.set('filter', filter);
    }
    const query = params.toString();
    const path = `/projects${query ? `?${query}` : ''}`;
    const result = await this.request<{ projects?: StitchProject[] }>('GET', path);
    return result.projects || [];
  }

  async getProject(name: string): Promise<StitchProject> {
    // name is "projects/{id}"
    return this.request<StitchProject>('GET', `/${name}`);
  }

  async createProject(title: string): Promise<StitchProject> {
    return this.request<StitchProject>('POST', '/projects', { title });
  }

  async listScreens(projectId: string): Promise<StitchScreen[]> {
    const result = await this.request<{ screens?: StitchScreen[] }>(
      'GET',
      `/projects/${projectId}/screens`
    );
    return result.screens || [];
  }

  async getScreen(projectId: string, screenId: string): Promise<StitchScreen> {
    return this.request<StitchScreen>(
      'GET',
      `/projects/${projectId}/screens/${screenId}`
    );
  }

  async generateScreenFromText(options: GenerateScreenOptions): Promise<{
    screen: StitchScreen;
    outputComponents?: Array<{ text?: string; suggestions?: string[] }>;
  }> {
    const body: Record<string, unknown> = {
      prompt: options.prompt,
    };
    if (options.deviceType) {
      body['deviceType'] = options.deviceType;
    }
    if (options.modelId) {
      body['modelId'] = options.modelId;
    }

    return this.request(
      'POST',
      `/projects/${options.projectId}/screens:generateFromText`,
      body
    );
  }

  async extractDesignContext(projectId: string, screenId: string): Promise<DesignContext> {
    const context: DesignContext = {
      colors: [],
      fonts: [],
      spacing: [],
      layouts: [],
    };

    // Download the actual code files to extract design tokens
    const { html, css } = await this.fetchScreenCode(projectId, screenId);

    if (css) {
      context.colors = this.extractColors(css);
      context.fonts = this.extractFonts(css);
      context.spacing = this.extractSpacing(css);
    }
    if (html) {
      context.layouts = this.extractLayouts(html);
    }

    return context;
  }

  async fetchScreenImage(projectId: string, screenId: string): Promise<string> {
    const screen = await this.getScreen(projectId, screenId);
    return screen.screenshot?.downloadUrl || '';
  }

  async fetchScreenCode(projectId: string, screenId: string): Promise<{ html: string; css: string }> {
    const screen = await this.getScreen(projectId, screenId);
    let html = '';
    let css = '';

    if (screen.htmlCode?.downloadUrl) {
      html = await this.downloadFile(screen.htmlCode.downloadUrl);
    }
    if (screen.cssCode?.downloadUrl) {
      css = await this.downloadFile(screen.cssCode.downloadUrl);
    }
    return { html, css };
  }

  private async downloadFile(url: string): Promise<string> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(url, { headers });
      if (!response.ok) return '';
      return response.text();
    } catch {
      return '';
    }
  }

  // Design token extraction helpers

  private extractColors(css: string): DesignContext['colors'] {
    const colors: DesignContext['colors'] = [];
    const colorRegex = /(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\)|hsl[a]?\([^)]+\))/g;
    const seen = new Set<string>();

    let match;
    while ((match = colorRegex.exec(css)) !== null) {
      const hex = match[1]!;
      if (!seen.has(hex)) {
        seen.add(hex);
        colors.push({
          name: `color-${colors.length + 1}`,
          hex,
          usage: 'Extracted from CSS',
        });
      }
    }
    return colors;
  }

  private extractFonts(css: string): DesignContext['fonts'] {
    const fonts: DesignContext['fonts'] = [];
    const fontFamilyRegex = /font-family:\s*([^;]+)/g;
    const fontSizeRegex = /font-size:\s*([^;]+)/g;
    const fontWeightRegex = /font-weight:\s*([^;]+)/g;

    const families = new Set<string>();
    let match;

    while ((match = fontFamilyRegex.exec(css)) !== null) {
      const family = match[1]!.trim().replace(/['"]/g, '');
      if (!families.has(family)) {
        families.add(family);
      }
    }

    const sizes: string[] = [];
    while ((match = fontSizeRegex.exec(css)) !== null) {
      sizes.push(match[1]!.trim());
    }

    const weights: string[] = [];
    while ((match = fontWeightRegex.exec(css)) !== null) {
      weights.push(match[1]!.trim());
    }

    for (const family of families) {
      fonts.push({
        family,
        weight: weights[0] || '400',
        size: sizes[0] || '16px',
        usage: 'Extracted from CSS',
      });
    }

    return fonts;
  }

  private extractSpacing(css: string): DesignContext['spacing'] {
    const spacing: DesignContext['spacing'] = [];
    const spacingRegex = /(margin|padding|gap):\s*([^;]+)/g;
    const seen = new Set<string>();

    let match;
    while ((match = spacingRegex.exec(css)) !== null) {
      const value = match[2]!.trim();
      const key = `${match[1]}-${value}`;
      if (!seen.has(key)) {
        seen.add(key);
        spacing.push({
          name: match[1]!,
          value,
        });
      }
    }
    return spacing;
  }

  private extractLayouts(html: string): DesignContext['layouts'] {
    const layouts: DesignContext['layouts'] = [];

    if (html.includes('display: flex') || html.includes('display:flex')) {
      layouts.push({ type: 'Flexbox', description: 'Uses CSS Flexbox for layout' });
    }
    if (html.includes('display: grid') || html.includes('display:grid')) {
      layouts.push({ type: 'Grid', description: 'Uses CSS Grid for layout' });
    }
    if (html.includes('position: absolute') || html.includes('position:absolute')) {
      layouts.push({ type: 'Absolute', description: 'Uses absolute positioning' });
    }

    return layouts;
  }
}
