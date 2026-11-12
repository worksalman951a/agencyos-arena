import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { BentoProjectsView } from '@/components/projects/bento-projects-view';
import { BentoProjectRecordView } from '@/components/projects/bento-project-record-view';
import type {
  ProjectResponse,
  ProjectWorkspaceDetails,
  ProjectMemberSummary,
} from '@/lib/services/crm/project-service';

vi.mock('@/components/providers/bento-theme-provider', () => ({
  useBentoShell: vi.fn(() => true),
}));

const mockProjects: ProjectResponse[] = [
  {
    id: 'proj-1',
    organizationId: 'org-test',
    clientId: 'client-1',
    templateId: null,
    name: 'Website Redesign & Brand Revamp',
    status: 'active',
    budget: '25000.00',
    startDate: new Date('2026-11-01'),
    endDate: new Date('2026-12-15'),
    description: 'Comprehensive digital redesign for key client.',
    deletedAt: null,
    createdBy: 'usr-1',
    updatedBy: 'usr-1',
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-05'),
    client: {
      id: 'client-1',
      firstName: 'Alice',
      lastName: 'Smith',
      account: { id: 'acc-1', name: 'Acme Global Corp' },
    },
    template: null,
    tasks: [
      {
        id: 'task-1',
        projectId: 'proj-1',
        assigneeId: 'usr-1',
        milestoneId: 'ms-1',
        title: 'Information Architecture & Wireframes',
        status: 'done',
        priority: 'high',
        dueDate: new Date('2026-11-10'),
        estimatedHours: '40.00',
        createdAt: new Date('2026-11-01'),
        updatedAt: new Date('2026-11-05'),
        assignee: { id: 'usr-1', name: 'Dev Lead', email: 'dev@acme.com' },
        milestone: { id: 'ms-1', name: 'Phase 1: Discovery', status: 'completed' },
      },
      {
        id: 'task-2',
        projectId: 'proj-1',
        assigneeId: 'usr-1',
        milestoneId: null,
        title: 'Component Library Implementation',
        status: 'todo',
        priority: 'urgent',
        dueDate: new Date('2026-11-20'),
        estimatedHours: '60.00',
        createdAt: new Date('2026-11-01'),
        updatedAt: new Date('2026-11-05'),
        assignee: { id: 'usr-1', name: 'Dev Lead', email: 'dev@acme.com' },
        milestone: null,
      },
    ],
    milestoneCount: 2,
  },
];

const mockWorkspace: ProjectWorkspaceDetails = {
  milestones: [
    {
      id: 'ms-1',
      projectId: 'proj-1',
      name: 'Phase 1: Discovery',
      dueDate: new Date('2026-11-10'),
      status: 'completed',
      totalTasks: 1,
      completedTasks: 1,
      createdAt: new Date('2026-11-01'),
      updatedAt: new Date('2026-11-05'),
    },
  ],
  timeSummary: {
    entryCount: 5,
    totalHours: 35.5,
    billableHours: 30.0,
    nonBillableHours: 5.5,
  },
  counts: {
    files: 4,
    approvals: 2,
    changeOrders: 1,
  },
  activity: [
    {
      id: 'act-1',
      action: 'task.complete',
      entityType: 'Task',
      entityId: 'task-1',
      actorName: 'Dev Lead',
      createdAt: new Date('2026-11-05'),
    },
  ],
};

const mockMembers: ProjectMemberSummary[] = [
  { id: 'usr-1', name: 'Dev Lead', email: 'dev@acme.com' },
];

describe('Bento Phase 6A Integration: Projects Directory, Record, Tasks & Milestones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders BentoProjectsView with StatStrip velocity metrics and projects register', () => {
    render(
      <BentoProjectsView
        projects={mockProjects}
        total={1}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        sortBy="createdAt"
        sortOrder="desc"
        onSearchChange={() => {}}
        onStatusFilterChange={() => {}}
      />
    );

    expect(screen.getByText('Active Engagements')).toBeInTheDocument();
    expect(screen.getAllByText('Task Progress').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Website Redesign & Brand Revamp').length).toBeGreaterThan(0);
    expect(screen.getByText('Acme Global Corp')).toBeInTheDocument();
  });

  it('allows clicking a project in BentoProjectsView to inspect details in the Project Inspector', () => {
    render(
      <BentoProjectsView
        projects={mockProjects}
        total={1}
        totalPages={1}
        page={1}
        searchVal=""
        statusFilter=""
        sortBy="createdAt"
        sortOrder="desc"
        onSearchChange={() => {}}
        onStatusFilterChange={() => {}}
      />
    );

    const projectRow = screen.getByRole('button', {
      name: /Website Redesign & Brand Revamp/i,
    });
    fireEvent.click(projectRow);

    expect(screen.getByText('Project Inspector')).toBeInTheDocument();
    expect(screen.getByText('Open Workspace')).toBeInTheDocument();
  });

  it('renders BentoProjectRecordView with milestone and task sections', () => {
    render(
      <BentoProjectRecordView
        project={mockProjects[0]}
        workspace={mockWorkspace}
        members={mockMembers}
        contracts={[
          {
            id: 'contract-1',
            title: 'Master Service Agreement 2026',
            status: 'signed',
            signedAt: new Date('2026-11-01'),
          },
        ]}
        actionsNode={<button type="button">Project Actions</button>}
        milestonesNode={<div data-testid="milestones-section">Milestones Section</div>}
        tasksNode={<div data-testid="tasks-section">Tasks Section</div>}
      />
    );

    expect(screen.getAllByText('Website Redesign & Brand Revamp').length).toBeGreaterThan(0);
    expect(screen.getByText('Task Progress')).toBeInTheDocument();
    expect(screen.getByText('Milestones Reached')).toBeInTheDocument();
    expect(screen.getByTestId('milestones-section')).toBeInTheDocument();
    expect(screen.getByTestId('tasks-section')).toBeInTheDocument();
    expect(screen.getByText('Master Service Agreement 2026')).toBeInTheDocument();
  });
});
