import { observer } from "mobx-react";
import { CloseIcon, PinIcon } from "outline-icons";
import * as React from "react";
import { useHistory, useLocation } from "react-router-dom";
import styled from "styled-components";
import ButtonSmall from "~/components/ButtonSmall";
import Flex from "~/components/Flex";
import useStores from "~/hooks/useStores";
import { s } from "@shared/styles";

const isDocumentPath = (path: string) =>
  path.startsWith("/doc/") && !path.includes("/history");

function TabBar() {
  const { tabs, documents } = useStores();
  const location = useLocation();
  const history = useHistory();
  const current = isDocumentPath(location.pathname) ? location.pathname : null;

  React.useEffect(() => {
    if (!current) return;
    const slug = current.slice("/doc/".length).replace(/\/edit$/, "");
    const document = documents.get(slug);
    tabs.open({
      id: current,
      url: current,
      title: document?.title ?? "Untitled",
      emoji: document?.emoji,
    });
    if (document) tabs.update(current, { title: document.title, emoji: document.emoji });
  }, [current, documents, tabs]);

  if (!tabs.tabs.length) return null;

  const close = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    const next = tabs.close(id);
    if (id === current) {
      history.push(next ? tabs.tabs.find((tab) => tab.id === next)?.url ?? "/" : "/");
    }
  };

  return (
    <Bar role="tablist" aria-label="Open documents">
      {tabs.tabs.map((tab) => (
        <Tab
          key={tab.id}
          role="tab"
          aria-selected={tab.id === current}
          $active={tab.id === current}
          $pinned={tab.pinned}
          draggable
          onDragStart={(event) => event.dataTransfer.setData("text/plain", tab.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => tabs.move(event.dataTransfer.getData("text/plain"), tab.id)}
          onClick={() => history.push(tab.url)}
          onAuxClick={(event) => event.button === 1 && close(event, tab.id)}
        >
          <TabLabel title={tab.title}>
            {tab.pinned && <PinIcon size={12} />}
            {tab.emoji && <span>{tab.emoji}</span>}
            {tab.title}
          </TabLabel>
          {!tab.pinned && (
            <ButtonSmall
              type="button"
              onClick={(event) => close(event, tab.id)}
              aria-label={`Close ${tab.title}`}
              icon={<CloseIcon size={14} />}
              neutral
            />
          )}
        </Tab>
      ))}
    </Bar>
  );
}

const Bar = styled(Flex)`
  align-items: stretch;
  gap: 2px;
  min-height: 38px;
  padding: 4px 10px 0;
  overflow-x: auto;
  border-bottom: 1px solid ${s("divider")};
  background: ${s("background")};
`;

const Tab = styled.div<{ $active: boolean; $pinned: boolean }>`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 120px;
  max-width: 240px;
  padding: 6px 7px 6px 10px;
  border-radius: 6px 6px 0 0;
  color: ${(props) => (props.$active ? props.theme.text : props.theme.textTertiary)};
  background: ${(props) => (props.$active ? props.theme.background : "transparent")};
  border: 1px solid ${(props) => (props.$active ? props.theme.divider : "transparent")};
  border-bottom-color: ${(props) => (props.$active ? props.theme.background : "transparent")};
  opacity: ${(props) => (props.$pinned ? 0.92 : 1)};
  cursor: pointer;
`;

const TabLabel = styled.span`
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
`;

export default observer(TabBar);
