import { describe, it, expect } from 'vitest';
import { fetchAllWorkflows, fetchWorkflowById } from '../src/cli';

type RequestFn = (method: string, url: string, headers?: any, body?: any) => Promise<any>;

describe('API helpers with mocked requester', () => {
  it('fetchAllWorkflows handles array response', async () => {
    const mock: RequestFn = async (method, url) => {
      expect(method).toBe('GET');
      expect(url).toContain('/api/v1/workflows');
      return [{ id: '1', name: 'Flow A' }, { id: '2', name: 'Flow B' }];
    };
    const res = await fetchAllWorkflows(mock, 'https://example.com', 'k');
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
  });

  it('fetchAllWorkflows handles {data: []} response', async () => {
    const mock: RequestFn = async () => ({ data: [{ id: '3' }] });
    const res = await fetchAllWorkflows(mock, 'https://example.com', 'k');
    expect(res.length).toBe(1);
    expect(res[0].id).toBe('3');
  });

  it('fetchWorkflowById returns the workflow', async () => {
    const mock: RequestFn = async (method, url) => {
      expect(method).toBe('GET');
      expect(url).toContain('/api/v1/workflows/abc');
      return { id: 'abc', name: 'My Flow', nodes: [], connections: {} };
    };
    const wf = await fetchWorkflowById(mock, 'https://example.com', 'k', 'abc');
    expect(wf.id).toBe('abc');
    expect(wf.name).toBe('My Flow');
  });
});
