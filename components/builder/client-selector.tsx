'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Search, User, Briefcase, Loader2 } from 'lucide-react';

interface ClientSelectorProps {
  contacts: Array<{
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    organizationId?: string;
  }>;
  opportunities: Array<{
    id: string;
    title: string;
    organizationId?: string;
    contactId?: string | null;
  }>;
  selectedContactId: string | null;
  selectedOpportunityId: string | null;
  onContactSelect: (id: string | null) => void;
  onOpportunitySelect: (id: string | null) => void;
  loading: boolean;
}

export function ClientSelector({
  contacts,
  opportunities,
  selectedContactId,
  selectedOpportunityId,
  onContactSelect,
  onOpportunitySelect,
  loading,
}: ClientSelectorProps) {
  const [contactQuery, setContactQuery] = React.useState('');
  const [oppQuery, setOppQuery] = React.useState('');

  const filteredContacts = React.useMemo(() => {
    const q = contactQuery.toLowerCase().trim();
    if (!q) return contacts.slice(0, 10);
    return contacts.filter((c) =>
      [c.firstName ?? '', c.lastName ?? '', c.email ?? ''].join(' ').toLowerCase().includes(q)
    );
  }, [contacts, contactQuery]);

  const filteredOpportunities = React.useMemo(() => {
    const q = oppQuery.toLowerCase().trim();
    if (!q) return opportunities.slice(0, 10);
    return opportunities.filter((o) => o.title.toLowerCase().includes(q));
  }, [opportunities, oppQuery]);

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          CRM Selection
        </h2>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm font-semibold">Select Contact</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search contacts by name or email..."
                value={contactQuery}
                onChange={(e) => setContactQuery(e.target.value)}
                disabled={loading}
                className="pl-10"
              />
            </div>
            {loading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading contacts…
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                No contacts found.{' '}
                {selectedContactId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="link"
                    onClick={() => onContactSelect(null)}
                  >
                    Clear selection
                  </Button>
                )}
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto border border-border rounded-lg">
                {filteredContacts.map((contact) => {
                  const name =
                    [contact.firstName ?? '', contact.lastName ?? ''].join(' ').trim() ||
                    'Unnamed Contact';
                  const isSelected = contact.id === selectedContactId;
                  return (
                    <button
                      type="button"
                      key={contact.id}
                      onClick={() => onContactSelect(contact.id)}
                      className={`
                        w-full flex items-center justify-between px-4 py-3 text-left transition-colors
                        border-b border-border last:border-b-0
                        ${isSelected ? 'bg-accent/10 text-accent-foreground' : 'text-foreground hover:bg-muted/50'}
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{name}</p>
                          {contact.email && (
                            <p className="text-xs text-muted-foreground truncate">
                              {contact.email}
                            </p>
                          )}
                        </div>
                        {isSelected && (
                          <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded">
                            Selected
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm font-semibold">Link Opportunity (Optional)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            <div className="relative">
              <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search opportunities by title..."
                value={oppQuery}
                onChange={(e) => setOppQuery(e.target.value)}
                disabled={loading}
                className="pl-10"
              />
            </div>
            {loading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading opportunities…
              </div>
            ) : filteredOpportunities.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                No opportunities found.
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto border border-border rounded-lg">
                {filteredOpportunities.map((opp) => {
                  const isSelected = opp.id === selectedOpportunityId;
                  return (
                    <button
                      type="button"
                      key={opp.id}
                      onClick={() => onOpportunitySelect(opp.id)}
                      className={`
                        w-full flex items-center justify-between px-4 py-3 text-left transition-colors
                        border-b border-border last:border-b-0
                        ${isSelected ? 'bg-accent/10 text-accent-foreground' : 'text-foreground hover:bg-muted/50'}
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{opp.title}</p>
                        </div>
                        {isSelected && (
                          <span className="text-xs bg-accent text-accent-foreground px-1.5 py-0.5 rounded">
                            Selected
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedContactId || selectedOpportunityId ? (
        <div className="flex gap-2">
          {selectedContactId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onContactSelect(null)}
              className="flex items-center gap-1"
            >
              <span className="text-muted-foreground">×</span> Clear Contact
            </Button>
          )}
          {selectedOpportunityId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpportunitySelect(null)}
              className="flex items-center gap-1"
            >
              <span className="text-muted-foreground">×</span> Clear Opportunity
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
