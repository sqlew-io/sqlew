/**
 * Decision template parameter and response types (FR-006)
 */

import type { StatusString } from '../enums.js';

export interface SetFromTemplateParams {
  template: string;  // Template name
  key: string;
  value: string | number;
  agent?: string;
  // Override template defaults if needed
  layer?: string;
  version?: string;
  status?: StatusString;
  tags?: string[];
  scopes?: string[];
  // Required fields (template-specific)
  [key: string]: any;
}

export interface CreateTemplateParams {
  name: string;
  defaults: {
    layer?: string;
    status?: StatusString;
    tags?: string[];
    priority?: 'low' | 'medium' | 'high' | 'critical';
  };
  required_fields?: string[];
  created_by?: string;
}

export interface ListTemplatesParams {
  // No parameters - returns all templates
}

export interface SetFromTemplateResponse {
  success: boolean;
  key: string;
  key_id: number;
  version: string;
  template_used: string;
  applied_defaults: {
    layer?: string;
    tags?: string[];
    status?: string;
  };
  message?: string;
}

export interface CreateTemplateResponse {
  success: boolean;
  template_id: number;
  template_name: string;
  message?: string;
}

export interface ListTemplatesResponse {
  templates: Array<{
    id: number;
    name: string;
    defaults: any;  // Parsed JSON
    required_fields: string[] | null;  // Parsed JSON array
    // Note: created_by field removed in v4.0 (agent tracking eliminated)
    created_at: string;
  }>;
  count: number;
}
