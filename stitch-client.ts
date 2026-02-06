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

    // Get screen data for theme fallback
    const screen = await this.getScreen(projectId, screenId);

    // Download the actual code files to extract design tokens
    const { html, css } = await this.fetchScreenCode(projectId, screenId);

    // Combine CSS sources: separate CSS file + inline <style> tags
    const inlineStyles = html ? this.extractInlineStyles(html) : '';
    const allCss = [css, inlineStyles].filter(Boolean).join('\n');

    // Extract from standard CSS
    if (allCss) {
      context.colors = this.extractColors(allCss);
      context.fonts = this.extractFonts(allCss);
      context.spacing = this.extractSpacing(allCss);
    }

    // Extract from Tailwind config (Stitch screens use Tailwind CSS)
    if (html) {
      const tailwindConfig = this.extractTailwindConfig(html);
      if (tailwindConfig) {
        context.colors.push(...this.extractTailwindColors(tailwindConfig));
        context.fonts.push(...this.extractTailwindFonts(tailwindConfig, html));
      }
      context.layouts = this.extractLayouts(html);
    }

    // Fallback: use screen.theme data (always available from Stitch API)
    if (screen.theme) {
      const theme = screen.theme as Record<string, unknown>;
      if (theme.customColor && typeof theme.customColor === 'string') {
        const hasColor = context.colors.some(c => c.hex.toLowerCase() === (theme.customColor as string).toLowerCase());
        if (!hasColor) {
          context.colors.unshift({ name: 'primary', hex: theme.customColor as string, usage: 'Theme primary color' });
        }
      }
      if (theme.font && typeof theme.font === 'string') {
        const fontName = (theme.font as string).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const hasFont = context.fonts.some(f => f.family.toLowerCase().includes(fontName.toLowerCase()));
        if (!hasFont) {
          context.fonts.unshift({ family: fontName, weight: '400', size: '16px', usage: 'Theme font' });
        }
      }
      if (theme.colorMode && typeof theme.colorMode === 'string') {
        context.layouts.unshift({ type: theme.colorMode as string, description: `${theme.colorMode} color mode` });
      }
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
      // usercontent.google.com URLs have auth baked into URL params —
      // sending OAuth headers causes the request to fail
      const needsAuth = !url.includes('usercontent.google.com');
      const options: RequestInit = {};
      if (needsAuth) {
        options.headers = await this.getHeaders();
      }
      const response = await fetch(url, options);
      if (!response.ok) return '';
      return response.text();
    } catch {
      return '';
    }
  }

  // Design token extraction helpers

  private extractInlineStyles(html: string): string {
    const parts: string[] = [];
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let match;
    while ((match = styleRegex.exec(html)) !== null) {
      parts.push(match[1]!);
    }
    return parts.join('\n');
  }

  private extractTailwindConfig(html: string): string {
    // Match tailwind.config = { ... } in script tags
    const configRegex = /tailwind\.config\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/;
    const match = configRegex.exec(html);
    return match ? match[1]! : '';
  }

  private extractTailwindColors(config: string): DesignContext['colors'] {
    const colors: DesignContext['colors'] = [];
    // Match hex colors in the config with their key names
    // Pattern: 'key': '#hex' or key: '#hex' or DEFAULT: '#hex'
    const colorRegex = /['"]?(\w+)['"]?\s*:\s*['"]?(#[0-9a-fA-F]{3,8})['"]?/g;
    const seen = new Set<string>();
    let match;
    while ((match = colorRegex.exec(config)) !== null) {
      const name = match[1]!;
      const hex = match[2]!;
      if (!seen.has(hex.toLowerCase())) {
        seen.add(hex.toLowerCase());
        colors.push({ name, hex, usage: 'Tailwind theme' });
      }
    }
    return colors;
  }

  private extractTailwindFonts(config: string, html: string): DesignContext['fonts'] {
    const fonts: DesignContext['fonts'] = [];
    const seen = new Set<string>();

    // Extract font families from Tailwind config: fontFamily: { sans: ['Lexend', ...] }
    const fontRegex = /fontFamily[\s\S]*?['"](\w[\w\s]*)['"](?:\s*,|\s*\])/g;
    let match;
    while ((match = fontRegex.exec(config)) !== null) {
      const family = match[1]!.trim();
      if (family && !seen.has(family.toLowerCase())) {
        seen.add(family.toLowerCase());
        fonts.push({ family, weight: '400', size: '16px', usage: 'Tailwind theme' });
      }
    }

    // Extract from Google Fonts links: fonts.googleapis.com/css2?family=Lexend
    const googleFontsRegex = /fonts\.googleapis\.com\/css2?\?family=([^&"'<>\s]+)/g;
    while ((match = googleFontsRegex.exec(html)) !== null) {
      const family = decodeURIComponent(match[1]!).split(':')[0]!.replace(/\+/g, ' ').trim();
      if (family && !seen.has(family.toLowerCase())) {
        seen.add(family.toLowerCase());
        fonts.push({ family, weight: '400', size: '16px', usage: 'Google Fonts' });
      }
    }

    return fonts;
  }

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

    // Check both CSS properties and Tailwind classes
    if (html.includes('display: flex') || html.includes('display:flex') || /\bflex\b/.test(html)) {
      layouts.push({ type: 'Flexbox', description: 'Uses CSS Flexbox for layout' });
    }
    if (html.includes('display: grid') || html.includes('display:grid') || /\bgrid\b/.test(html)) {
      layouts.push({ type: 'Grid', description: 'Uses CSS Grid for layout' });
    }
    if (html.includes('position: absolute') || html.includes('position:absolute') || /\babsolute\b/.test(html)) {
      layouts.push({ type: 'Absolute', description: 'Uses absolute positioning' });
    }

    return layouts;
  }
}
