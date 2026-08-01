from typing import Optional
from pydantic import BaseModel


class BookOut(BaseModel):
    id: int
    title: str
    author: Optional[str] = None


class ChapterOut(BaseModel):
    id: int
    title: str
    order_idx: int
    parent_id: Optional[int] = None


class BlockOut(BaseModel):
    id: int
    chapter_id: Optional[int]
    order_idx: int
    type: str
    text: str


class SearchHit(BaseModel):
    block_id: int
    book_id: int
    chapter_id: Optional[int]
    snippet: str


class PassageIn(BaseModel):
    book_id: int
    start_block: int
    start_off: int
    end_block: int
    end_off: int


class PassageOut(BaseModel):
    id: int
    book_id: int
    start_block: int
    start_off: int
    end_block: int
    end_off: int


class HighlightIn(BaseModel):
    color: str = "yellow"


class NoteIn(BaseModel):
    body: str
    passage_id: Optional[int] = None
    chapter_id: Optional[int] = None
    book_id: Optional[int] = None


class NoteUpdate(BaseModel):
    body: str


class TagIn(BaseModel):
    name: str


class LinkIn(BaseModel):
    to_passage: int
    note: Optional[str] = None


class SummaryIn(BaseModel):
    scope: str
    scope_id: int
    body: str
    generated_by: str = "user"


class FocusIn(BaseModel):
    block_id: int
