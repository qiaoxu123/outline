import * as React from "react";
import styled from "styled-components";
import ButtonSmall from "~/components/ButtonSmall";

interface WorkspacePaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}

/** Keep large indexes searchable while bounding the number of rendered rows. */
export function WorkspacePagination({
  page,
  total,
  pageSize,
  onChange,
}: WorkspacePaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) {
    return null;
  }
  return (
    <Pagination aria-label="列表分页">
      <span aria-live="polite">
        {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} / {total}
      </span>
      <ButtonSmall neutral disabled={page === 0} onClick={() => onChange(page - 1)}>
        上一页
      </ButtonSmall>
      <span>{page + 1} / {pages}</span>
      <ButtonSmall neutral disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>
        下一页
      </ButtonSmall>
    </Pagination>
  );
}

/** Clamp pagination immediately when filters or a refreshed index shrink it. */
export function useWorkspacePage(total: number, filterKey: string, pageSize = 50) {
  const [selection, setSelection] = React.useState({ filterKey, page: 0 });
  const page = Math.min(
    selection.filterKey === filterKey ? selection.page : 0,
    Math.max(0, Math.ceil(total / pageSize) - 1)
  );
  return {
    page,
    pageSize,
    setPage: (next: number) => setSelection({ filterKey, page: Math.max(0, next) }),
  };
}

export const WorkspaceNotice = styled.p`
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px solid ${(p) => p.theme.divider};
  border-left: 3px solid ${(p) => p.theme.danger};
  border-radius: 6px;
  color: ${(p) => p.theme.danger};
  background: ${(p) => p.theme.backgroundSecondary};
  font-size: 13px;
`;

const Pagination = styled.nav`
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  margin-top: 20px;
  color: ${(p) => p.theme.textTertiary};
  font-size: 13px;
`;
