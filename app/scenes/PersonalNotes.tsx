import { NotepadIcon } from "outline-icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import styled from "styled-components";
import { client } from "~/utils/ApiClient";
import Scene from "~/components/Scene";
import Empty from "~/components/Empty";
import useCurrentUser from "~/hooks/useCurrentUser";
import useStores from "~/hooks/useStores";
import type { CustomDocument } from "./customData";

type Note = CustomDocument;

/** Personal notes entry point. Notes remain Outline documents, so the official
 * document editor is used when a note is opened. */
export default function PersonalNotes() {
  const { t } = useTranslation();
  const history = useHistory();
  const user = useCurrentUser();
  const { documents } = useStores();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    client
      .post<{ data: Note[] }>("/documents.list", {
        // `userId` means collaborator in Outline's API. Filter by creator
        // below so this entry really represents the user's private notes.
        sort: "updatedAt",
        direction: "DESC",
        limit: 50,
      })
      .then((response) => {
        if (!cancelled) {
          setNotes((response.data ?? []).filter((note) => note.createdBy?.id === user.id));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotes([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  return (
    <Scene icon={<NotepadIcon />} title="个人笔记" textTitle="个人笔记">
      <Heading>个人笔记</Heading>
      {loading ? <Empty>{t("Loading…")}</Empty> : null}
      {!loading && notes.length === 0 ? (
        <Empty>还没有个人笔记。新建文档后，可以在这里集中查看。</Empty>
      ) : null}
      <List>
        {notes.map((note) => (
          <Row
            key={note.id}
            onClick={() => history.push(documents.get(note.id)?.url ?? `/doc/${note.id}`)}
          >
            <strong>{note.title || "未命名笔记"}</strong>
            {note.updatedAt ? <small>{note.updatedAt}</small> : null}
          </Row>
        ))}
      </List>
    </Scene>
  );
}

const Heading = styled.h2`
  margin: 24px 0 16px;
`;

const List = styled.div`
  display: grid;
  gap: 8px;
`;

const Row = styled.button`
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 14px 16px;
  border: 1px solid ${({ theme }) => theme.divider};
  border-radius: 8px;
  background: ${({ theme }) => theme.background};
  color: ${({ theme }) => theme.text};
  text-align: left;
  cursor: pointer;
`;
