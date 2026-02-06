import type { App } from '@modelcontextprotocol/ext-apps';
import type { GenerateDesignData } from '../types';

interface GenerateDesignProps {
  data: GenerateDesignData;
  app: App;
  onCallTool: (name: string, args: Record<string, unknown>) => Promise<void>;
}

export default function GenerateDesign({ data, app, onCallTool }: GenerateDesignProps) {
  const { screen, imageData, codeData, suggestions, prompt } = data;

  const screenName = screen?.title || 'Generated Screen';

  // Extract IDs from screen name
  const nameParts = screen?.name?.split('/') || [];
  const projectId = nameParts[1] || '';
  const screenId = nameParts[3] || '';

  const handleViewDetails = () => {
    if (projectId && screenId) {
      void onCallTool('design-viewer', { projectId, screenId });
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (projectId) {
      void onCallTool('generate-design', { projectId, prompt: suggestion });
    }
  };

  const handleOpenInStitch = () => {
    if (screen?.name) {
      void app.openLink({ url: `https://stitch.google.com/${screen.name}` });
    }
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Generated Design</h2>
        <div className="view-header-actions">
          {projectId && screenId && (
            <button className="btn btn-primary btn-sm" onClick={handleViewDetails}>
              View Details
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={handleOpenInStitch}>
            Open in Stitch
          </button>
        </div>
      </div>

      <div className="generate-result">
        {/* Prompt */}
        <div className="prompt-display">
          <span className="prompt-label">Prompt:</span>
          <span className="prompt-text">{prompt}</span>
        </div>

        {/* Preview */}
        <div className="generate-preview">
          {imageData ? (
            <img
              src={imageData}
              alt={screenName}
              className="generate-image"
            />
          ) : (
            <div className="generate-placeholder">
              <h3>{screenName}</h3>
              <p>Screen generated successfully.</p>
              {projectId && screenId && (
                <button className="btn btn-primary" onClick={handleViewDetails}>
                  View Full Design
                </button>
              )}
            </div>
          )}
        </div>

        {/* Code preview */}
        {codeData && (codeData.html || codeData.css) && (
          <div className="generate-code-preview">
            <h4>Generated Code</h4>
            {codeData.html && (
              <pre className="code-block code-block-sm">{codeData.html.substring(0, 500)}{codeData.html.length > 500 ? '...' : ''}</pre>
            )}
          </div>
        )}

        {/* Suggestions */}
        {suggestions && suggestions.length > 0 && (
          <div className="suggestions">
            <h4>Suggestions</h4>
            <div className="suggestion-chips">
              {suggestions.map((suggestion, i) => (
                <button
                  key={i}
                  className="suggestion-chip"
                  onClick={() => handleSuggestionClick(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
