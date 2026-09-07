import { observer } from "mobx-react";
import { CloseIcon, PinIcon } from "outline-icons";
import * as React from "react";
import { useHistory, useLocation } from "react-router-dom";
import styled from "styled-components";
import ButtonSmall from "~/components/ButtonSmall";
import Flex from "~/components/Flex";
import { Menu, MenuButton, MenuContent, MenuSeparator, MenuTrigger } from "~/components/primitives/Menu";
import { MenuProvider } from "~/components/primitives/Menu/MenuContext";
import useStores from "~/hooks/useStores";
import { s } from "@shared/styles";
import { preventDefault } from "~/utils/events";
import { documentTabId, openInTab } from "~/utils/tabNavigation";

const isDocumentPath = (path: string) =>
  path.startsWith("/doc/") && !path.includes("/history");

function TabBar() {
  const { tabs, documents } = useStores();
  const location = useLocation();
  const history = useHistory();
  const current = isDocumentPath(location.pathname)
    ? documentTabId(location.pathname)
    : null;

  React.useEffect(() => {
    if (!current) return;
    const slug = current.slice("/doc/".length).replace(/\/edit$/, "");
    const document = documents.get(slug);
    tabs.open({
      id: current,
      url: location.pathname,
      title: document?.title ?? "Untitled",
      emoji: document?.icon,
    });
    if (document)
      tabs.update(current, {
        title: document.title,
        emoji: document.icon,
        url: location.pathname,
      });
  }, [current, documents, location.pathname, tabs]);

  if (!tabs.tabs.length) return null;

  const close = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    closeTab(id);
  };

  const closeTab = (id: string) => {
    const next = tabs.close(id);
    if (id === current) {
      history.push(next ? tabs.tabs.find((tab) => tab.id === next)?.url ?? "/" : "/");
    }
  };

  const ensureCurrent = () => {
    if (current && !tabs.tabs.some((tab) => tab.id === current)) {
      history.push(tabs.tabs[0]?.url ?? "/");
    }
  };

  return (
    <Bar role="tablist" aria-label="Open documents">
      {tabs.tabs.map((tab) => (
        <TabContextMenu
          key={tab.id}
          tab={tab}
          current={tab.id === current}
          onTogglePin={() => tabs.togglePin(tab.id)}
          onClose={() => closeTab(tab.id)}
          onCloseOthers={() => {
            tabs.closeOthers(tab.id);
            ensureCurrent();
          }}
          onCloseAll={() => {
            tabs.closeAll();
            ensureCurrent();
          }}
        >
          <Tab
            role="tab"
            aria-selected={tab.id === current}
            aria-label={tab.title || "Untitled"}
            tabIndex={tab.id === current ? 0 : -1}
            $active={tab.id === current}
            $pinned={tab.pinned}
            draggable
            onDragStart={(event) => event.dataTransfer.setData("text/plain", tab.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const fromId = event.dataTransfer.getData("text/plain");
              const from = tabs.tabs.find((item) => item.id === fromId);
              if (from?.pinned === tab.pinned) tabs.move(fromId, tab.id);
            }}
            onClick={() => openInTab(history, tabs, tab)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openInTab(history, tabs, tab);
              }
            }}
            onAuxClick={(event) => event.button === 1 && close(event, tab.id)}
          >
            <TabLabel title={tab.title}>
              {tab.pinned && <PinIcon size={12} aria-hidden />}
              {tab.emoji && <span aria-hidden>{tab.emoji}</span>}
              <span>{tab.title || "Untitled"}</span>
            </TabLabel>
            {!tab.pinned && (
              <ButtonSmall
                type="button"
                onClick={(event: React.MouseEvent) => close(event, tab.id)}
                aria-label={`Close ${tab.title || "Untitled"}`}
                icon={<CloseIcon size={14} />}
                neutral
              />
            )}
          </Tab>
        </TabContextMenu>
      ))}
    </Bar>
  );
}

function TabContextMenu({
  tab,
  current,
  onTogglePin,
  onClose,
  onCloseOthers,
  onCloseAll,
  children,
}: {
  tab: { id: string; title: string; pinned: boolean };
  current: boolean;
  onTogglePin: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <MenuProvider variant="context">
      <Menu>
        <MenuTrigger>{children}</MenuTrigger>
        <MenuContent
          aria-label={`${tab.title || "Untitled"} tab options`}
          onCloseAutoFocus={preventDefault}
        >
          <MenuButton
            label={tab.pinned ? "Unpin tab" : "Pin tab"}
            selected={tab.pinned}
            onClick={onTogglePin}
          />
          {!tab.pinned && (
            <MenuButton label="Close tab" onClick={onClose} />
          )}
          <MenuSeparator />
          <MenuButton label="Close other tabs" onClick={onCloseOthers} />
          <MenuButton label="Close all tabs" onClick={onCloseAll} />
        </MenuContent>
      </Menu>
    </MenuProvider>
  );
}

const Bar = styled(Flex)`
  width: 100%;
  flex-shrink: 0;
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

  &:hover {
    color: ${s("text")};
    background: ${s("backgroundSecondary")};
  }

  &:focus-visible {
    outline: 2px solid ${s("inputBorderFocused")};
    outline-offset: -2px;
  }
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
