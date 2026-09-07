import { observer } from "mobx-react";
import { CloseIcon, PinIcon } from "outline-icons";
import * as React from "react";
import { useHistory, useLocation } from "react-router-dom";
import styled from "styled-components";
import Flex from "~/components/Flex";
import {
  Menu,
  MenuButton,
  MenuContent,
  MenuSeparator,
  MenuTrigger,
} from "~/components/primitives/Menu";
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
    if (!current) {return;}
    const slug = current.slice("/doc/".length).replace(/\/edit$/, "");
    const document = documents.get(slug);
    tabs.open({
      id: current,
      url: location.pathname,
      title: document?.title ?? "Untitled",
      emoji: document?.icon,
    });
    if (document)
      {tabs.update(current, {
        title: document.title,
        emoji: document.icon,
        url: location.pathname,
      });}
  }, [current, documents, location.pathname, tabs]);

  if (!tabs.tabs.length) {return null;}

  const close = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    closeTab(id);
  };

  const closeTab = (id: string) => {
    const next = tabs.close(id);
    if (id === current) {
      history.push(
        next ? (tabs.tabs.find((tab) => tab.id === next)?.url ?? "/") : "/"
      );
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
            onDragStart={(event) =>
              event.dataTransfer.setData("text/plain", tab.id)
            }
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const fromId = event.dataTransfer.getData("text/plain");
              const from = tabs.tabs.find((item) => item.id === fromId);
              if (from?.pinned === tab.pinned) {tabs.move(fromId, tab.id);}
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
              <CloseButton
                type="button"
                onClick={(event: React.MouseEvent) => close(event, tab.id)}
                aria-label={`Close ${tab.title || "Untitled"}`}
              >
                <CloseIcon size={14} />
              </CloseButton>
            )}
          </Tab>
        </TabContextMenu>
      ))}
    </Bar>
  );
}

function TabContextMenu({
  tab,
  onTogglePin,
  onClose,
  onCloseOthers,
  onCloseAll,
  children,
}: {
  tab: { id: string; title: string; pinned: boolean };
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
          {!tab.pinned && <MenuButton label="Close tab" onClick={onClose} />}
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
  gap: 4px;
  min-height: 44px;
  padding: 6px 12px 0;
  overflow-x: auto;
  border-bottom: 1px solid ${s("divider")};
  background: ${s("backgroundSecondary")};
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const Tab = styled.div<{ $active: boolean; $pinned: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: ${(props) => (props.$pinned ? "56px" : "176px")};
  max-width: 300px;
  height: 38px;
  padding: 0 7px 0 13px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  color: ${(props) =>
    props.$active ? props.theme.text : props.theme.textTertiary};
  background: ${(props) =>
    props.$active ? props.theme.background : "transparent"};
  font-weight: ${(props) => (props.$active ? 500 : 400)};
  cursor: pointer;

  &::after {
    position: absolute;
    right: 10px;
    bottom: 0;
    left: 10px;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: ${(props) =>
      props.$active ? props.theme.accent : "transparent"};
    content: "";
  }

  ${(props) =>
    props.$active &&
    `
      border-color: ${props.theme.divider};
      box-shadow: 0 -1px 0 ${props.theme.background};
    `}

  &:hover {
    color: ${s("text")};
    background: ${s("backgroundTertiary")};

    &::after {
      background: ${(props) =>
        props.$active ? props.theme.accent : props.theme.divider};
    }
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
  line-height: 1;
`;

const CloseButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 23px;
  height: 23px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 5px;
  color: ${s("textTertiary")};
  background: transparent;
  opacity: 0;
  cursor: pointer;
  transition:
    opacity 120ms ease-out,
    background 120ms ease-out;

  ${Tab}[aria-selected="true"] &,
  ${Tab}:hover & {
    opacity: 1;
  }

  &:hover {
    color: ${s("text")};
    background: ${s("backgroundTertiary")};
  }

  &:focus-visible {
    opacity: 1;
    outline: 2px solid ${s("inputBorderFocused")};
    outline-offset: -1px;
  }
`;

export default observer(TabBar);
