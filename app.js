const SUPABASE_URL = 'https://otwqwuidhkbtfniwpzvf.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90d3F3dWlkaGtidGZuaXdwenZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzOTA0MjYsImV4cCI6MjA5Njk2NjQyNn0.dtPkiYdqo011OpytX6nCvMqiOzrdpEVZ8oj6NXPIsOE'; 

// 💡 名前が被らないように "supabaseClient" に変更しました
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 📦 アプリ用変数（LocalStorageの読み込みは廃止し、サーバーと連動します）
// ==========================================
let appData = []; 
let currentActiveListId = null; 
let quizData = []; 
let currentQuestions = []; 
let wrongQuestions = []; 
let currentIndex = 0; 
let memoIndex = 0; 
let isCardFront = true;
let quizHistoryLogs = []; 
let lastResultFeedbackHTML = ""; 
let autoNextTimer = null; 
let isBulkDeleteMode = false; 

const inputField = document.getElementById('chemInput');
const progressText = document.getElementById('progress');
const previousAnswerArea = document.getElementById('previousAnswerArea');

// 画面読み込み時の初期化
window.addEventListener('DOMContentLoaded', async () => {
  initInputFieldAutoConversion(document.getElementById('chemInput'));  
  initInputFieldAutoConversion(document.getElementById('newAnswer'));  
  initInputFieldAutoConversion(document.getElementById('modalEditA')); 
  
  // ✨ 単語帳の名前入力欄でEnterキーが押されたら、自動で作成する
  const newListNameInput = document.getElementById('newListName');
  if (newListNameInput) {
    newListNameInput.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        if (event.isComposing) return; // 💡 漢字変換を確定するためのEnterキーのときは、作成しない（スルーする）
        event.preventDefault(); // 画面がリロードされるのを防ぐ
        createNewList(); // 単語帳を作成する関数を実行！
      }
    });
  }

  window.addEventListener('hashchange', () => {
    routeView(window.location.hash);
  });

  // 1. まず最初にSupabaseから最新データをダウンロードする
  await loadAllAppDataFromSupabase();

// 2. その後、画面の状態（どこを開いていたか）を復旧
  loadViewStateOnly();

  // 🌟【新設】状態復旧が終わった直後に、正しい苦手問題の計算とリストの絞り込みを確定させる
  updateWrongCountLabel();
  renderMainList();

  if (!window.location.hash || window.location.hash === '#top') {
    navigateTo('#top');
    routeView('#top');
  } else {
    routeView(window.location.hash);
  }

  document.addEventListener('click', (e) => {
    if (window.location.hash.startsWith('#quiz') && inputField && !inputField.disabled) {
      if (!e.target.closest('button') && e.target !== inputField) {
        inputField.focus();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (window.location.hash.startsWith('#quiz') && inputField && !inputField.disabled) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (document.activeElement !== inputField) {
          inputField.focus();
        }
      }
    }
  });
});

function navigateTo(hash) {
  window.location.hash = hash;
}

// 🌐 Supabaseから全ての部屋と単語を一括取得して appData の形に整える
async function loadAllAppDataFromSupabase() {
  const { data: rooms, error: roomError } = await supabaseClient.from('rooms').select('*').order('created_at', { ascending: true });
  if (roomError) { console.error("部屋の取得失敗:", roomError); return; }

  const { data: words, error: wordError } = await supabaseClient.from('words').select('*').order('id', { ascending: true });
  if (wordError) { console.error("単語の取得失敗:", wordError); return; }

  appData = rooms.map(room => {
    const matchedItems = words ? words.filter(w => w.room_id === room.id) : [];
    return {
      listId: room.id,
      listName: room.title,
      listTags: room.tags || "",
      items: matchedItems.map(w => ({ id: w.id, question: w.question, answer: w.answer }))
    };
  });
}

function routeView(hash) {
  document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
  isBulkDeleteMode = false; 
  
  if (document.getElementById('bulkDeleteTriggerBtn')) document.getElementById('bulkDeleteTriggerBtn').style.display = "inline-block";
  if (document.getElementById('bulkExecuteBtn')) document.getElementById('bulkExecuteBtn').style.display = "none";
  if (document.getElementById('bulkCancelBtn')) document.getElementById('bulkCancelBtn').style.display = "none";

  if (!hash || hash.startsWith('#top')) {
    document.getElementById('topView').style.display = 'block';
    renderTopView();
  } 
  else if (hash.startsWith('#list')) {
    if (!currentActiveListId) { navigateTo('#top'); return; }
    document.getElementById('mainListView').style.display = 'block';
    const foundList = appData.find(l => l.listId === currentActiveListId);
    if (foundList) {
      document.getElementById('currentListTitle').textContent = foundList.listName;
      // タグがある時だけ余白（marginBottom）を付け、ない時は詰める
      const tArray = foundList.listTags ? foundList.listTags.split(',').map(t=>t.trim()).filter(t=>t) : [];
      const tagsContainer = document.getElementById('currentListTags');
      if (tArray.length > 0) {
        tagsContainer.style.marginBottom = '15px';
        tagsContainer.innerHTML = tArray.map(t => `<span class="list-tag-badge">#${t}</span>`).join(' ');
      } else {
        tagsContainer.style.marginBottom = '0px';
        tagsContainer.innerHTML = '';
      }
      
      renderMainList();
      updateChemPlaceholder(); // 💡 画面切り替え時にプレースホルダーを判定
    }
  } 
  else if (hash.startsWith('#memorize')) {
    if (!currentActiveListId || currentQuestions.length === 0) { navigateTo('#list'); return; }
    document.getElementById('memorizeView').style.display = 'block';
    showMemoCard();
    if (!isCardFront) {
      const card = document.getElementById('bigCard');
      card.textContent = currentQuestions[memoIndex].answer;
      card.classList.add('back-style');
    }
  } 
  else if (hash.startsWith('#quiz')) {
    if (!currentActiveListId || currentQuestions.length === 0) { navigateTo('#list'); return; }
    document.getElementById('quizView').style.display = 'block';
    document.getElementById('quizPlayArea').style.display = 'block';
    document.getElementById('quizResultArea').style.display = 'none';
    showQuestion();
  } 
  else if (hash.startsWith('#result')) {
    if (!currentActiveListId) { navigateTo('#top'); return; }
    document.getElementById('quizView').style.display = 'block';
    document.getElementById('quizPlayArea').style.display = 'none';
    document.getElementById('quizResultArea').style.display = 'block';
    showQuizReviewSummary();
  }
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function saveViewState() {
  const state = {
    listId: currentActiveListId,
    modeType: document.getElementById('modeWrongList') && document.getElementById('modeWrongList').checked ? 'wrong' : 'normal',
    rangeStart: document.getElementById('rangeStart') ? document.getElementById('rangeStart').value : "1",
    rangeEnd: document.getElementById('rangeEnd') ? document.getElementById('rangeEnd').value : "1",
    orderType: document.getElementById('orderRandom') && document.getElementById('orderRandom').checked ? 'random' : 'normal',
    // 🌟 修正：前行の末尾にカンマを追加し、構文エラーを解消しました！
    directionType: document.getElementById('dirReverse') && document.getElementById('dirReverse').checked ? 'reverse' : 'normal',
    maxQuestions: document.getElementById('maxQuestions') ? document.getElementById('maxQuestions').value : "",
    currentIndex: currentIndex,
    memoIndex: memoIndex,
    isCardFront: isCardFront,
    currentQuestions: currentQuestions,
    quizHistoryLogs: quizHistoryLogs,
    lastResultFeedbackHTML: lastResultFeedbackHTML
  };
  localStorage.setItem('multi_notebook_view_state', JSON.stringify(state));
}

function loadViewStateOnly() {
  const saved = localStorage.getItem('multi_notebook_view_state');
  if (!saved) return;
  try {
    const state = JSON.parse(saved);
    currentActiveListId = state.listId;
    const foundList = appData.find(l => l.listId === currentActiveListId);
    if (foundList) quizData = foundList.items;

    if (document.getElementById('modeWrongList')) {
      if (state.modeType === 'wrong') document.getElementById('modeWrongList').checked = true;
      else document.getElementById('modeNormal').checked = true;
      toggleModeUI();
    }
    if (document.getElementById('rangeStart')) document.getElementById('rangeStart').value = state.rangeStart || 1;
    if (document.getElementById('rangeEnd')) document.getElementById('rangeEnd').value = state.rangeEnd || (quizData.length > 0 ? quizData.length : 1);
    
    if (document.getElementById('orderRandom')) {
      if (state.orderType === 'random') document.getElementById('orderRandom').checked = true;
      else document.getElementById('orderNormal').checked = true;
    }
    
    // 🌟 修正：読み込み処理も安全な形でここに組み込みました！
    if (document.getElementById('dirReverse')) {
      if (state.directionType === 'reverse') document.getElementById('dirReverse').checked = true;
      else document.getElementById('dirNormal').checked = true;
    }
    
    currentIndex = state.currentIndex || 0;
    memoIndex = state.memoIndex || 0;
    isCardFront = (state.isCardFront !== undefined) ? state.isCardFront : true;
    currentQuestions = state.currentQuestions || [];
    quizHistoryLogs = state.quizHistoryLogs || [];
    lastResultFeedbackHTML = state.lastResultFeedbackHTML || "";
  } catch(e) {
    console.error("状態復帰エラー", e);
  }
}

function renderTopView() {
  const gallery = document.getElementById('listGallery');
  if(!gallery) return;
  gallery.innerHTML = "";

  appData.forEach(list => {
    const card = document.createElement('div');
    card.className = "list-card";
    card.onclick = () => openNotebook(list.listId);
    
    const infoWrapper = document.createElement('div');
    infoWrapper.className = "list-info";
    let tagsHTML = "";
    if (list.listTags) {
      const tagsArray = list.listTags.split(',').map(t => t.trim()).filter(t => t);
      tagsHTML = tagsArray.map(t => `<span class="list-tag-badge">#${t}</span>`).join(' ');
    }

    infoWrapper.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <span class="list-title-text">${list.listName}</span>
        <div>${tagsHTML}</div>
      </div>
      <span class="list-count-badge">${list.items.length} 問収録</span>
    `;
    card.appendChild(infoWrapper);

    const delBtn = document.createElement('button');
    delBtn.className = "direct-delete-btn";
    delBtn.innerHTML = "🗑️";
    delBtn.title = "このリストを削除";
    delBtn.onclick = (e) => {
      e.stopPropagation(); 
      triggerDeleteListModal(list.listId, list.listName);
    };
    card.appendChild(delBtn);

    gallery.appendChild(card);
  });
}

function triggerDeleteListModal(listId, listName) {
  document.getElementById('deleteModalText').innerHTML = `本当に単語帳<b>「${listName}」</b>を丸ごと削除してもよろしいですか？<br>この操作は取り消せません。`;
  openModal('deleteModal');
  
  document.getElementById('modalConfirmDeleteBtn').onclick = async () => {
    await supabaseClient.from('words').delete().eq('room_id', listId);
    await supabaseClient.from('rooms').delete().eq('id', listId);
    localStorage.removeItem(`chem_wrong_ids_${listId}`);
    
    closeModal('deleteModal');
    await loadAllAppDataFromSupabase(); 
    renderTopView();
    saveViewState();
  };
}

async function createNewList() {
  const input = document.getElementById('newListName');
  const name = input.value.trim();
  if (name === "") return;

  const { data, error } = await supabaseClient.from('rooms').insert([{ title: name }]).select();
  if (error) { showAlertModal("部屋の作成に失敗しました:" + error.message); return; }

  const newRoomId = data[0].id;
  input.value = "";
  
  await loadAllAppDataFromSupabase(); 
  renderTopView();
  openNotebook(newRoomId); 
}

function openNotebook(listId) {
  currentActiveListId = listId;
  const foundList = appData.find(l => l.listId === listId);
  if (foundList) {
    quizData = foundList.items;

    // 🌟【新設】別の単語帳を開いたときは、強制的に「通常モード」にリセットする
    const modeNormalRadio = document.getElementById('modeNormal');
    if (modeNormalRadio) {
      modeNormalRadio.checked = true; // 通常にチェックを入れる
    }
    toggleModeUI(); // 出題設定エリアを再表示し、リストを通常表示に戻す

    // 🌟【新設】新しいリストの件数に合わせて、範囲の初期値と苦手ラベルをセット
    const currentLen = quizData.length > 0 ? quizData.length : 1;
    if (document.getElementById('rangeStart')) document.getElementById('rangeStart').value = 1;
    if (document.getElementById('rangeEnd')) document.getElementById('rangeEnd').value = currentLen;
    updateWrongCountLabel();

    saveViewState();
    navigateTo('#list');
  }
}

async function editListNameInline() {
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (!foundList) return;
  
  const newName = prompt("新しい単語帳の名前を入力してください：", foundList.listName);
  if (newName === null) return; 
  const trimmed = newName.trim();
  if (trimmed === "") { showAlertModal("名前を空にすることはできません。"); return; }
  
  const { error } = await supabaseClient.from('rooms').update({ title: trimmed }).eq('id', currentActiveListId);
  if (error) { showAlertModal("名前の変更に失敗しました"); return; }

  foundList.listName = trimmed;
  document.getElementById('currentListTitle').textContent = trimmed;
  await loadAllAppDataFromSupabase();
  saveViewState();
}

// 💡 余計な処理や無駄な再レンダリングを削ぎ落とした最適化版
function renderMainList() {
  const container = document.getElementById('listContainer');
  if (!container) return;
  container.innerHTML = "";

  if (quizData.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:gray; padding:20px;">問題が登録されていません。</div>`;
    return;
  }

  const isWrongMode = document.getElementById('modeWrongList')?.checked;
  
  // 1. 出題モードに応じたフィルタリング
  const displayItems = isWrongMode 
    ? quizData.filter(item => getSavedWrongIds().includes(String(item.id)))
    : quizData;

  if (displayItems.length === 0 && isWrongMode) {
    container.innerHTML = `<div style="text-align:center; color:#009688; padding:20px; font-weight:bold;">🔥 現在、苦手な問題はありません！素晴らしい！🎉</div>`;
    return;
  }

  // 2. リストの描画
  displayItems.forEach((item) => {
    const originalNum = quizData.findIndex(q => String(q.id) === String(item.id)) + 1;
    const div = document.createElement('div');
    div.className = 'list-item';
    
    if (!isWrongMode) {
      div.draggable = true;
      div.dataset.id = item.id;
      setupDragAndDropEvents(div);
    }

    const showCheckbox = (typeof isBulkDeleteMode !== 'undefined' && isBulkDeleteMode);

    div.innerHTML = `
      <div class="list-num">${originalNum}</div>
      <div class="list-text-block" onclick="triggerEditWordModal('${item.id}', \`${item.question}\`, \`${item.answer}\`)">
        <span class="list-q">${item.question}</span>
        <span class="list-a">${item.answer}</span>
      </div>
      <div class="list-actions-right">
        <input type="checkbox" class="bulk-checkbox" value="${item.id}" style="display: ${showCheckbox ? 'block' : 'none'};">
        <button class="direct-delete-btn" onclick="openDeleteWordModal('${item.id}')" style="display: ${showCheckbox ? 'none' : 'block'};">🗑️</button>
      </div>
    `;
    container.appendChild(div);
  });
}

function setupDragAndDropEvents(element) {
  element.addEventListener('dragstart', (e) => {
    element.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  element.addEventListener('dragend', () => {
    element.classList.remove('dragging');
    
    // 💡 無駄な再描画（ループ）を回さず、メモリ上の配列順序だけをスマートに同期
    const container = document.getElementById('listContainer');
    const items = [...container.querySelectorAll('.list-item')];
    quizData = items.map(el => quizData.find(q => String(q.id) === String(el.dataset.id))).filter(Boolean);
    saveViewState();
  });

  const container = document.getElementById('listContainer');
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    const draggingElement = document.querySelector('.dragging');
    if (!draggingElement) return;

    const afterElement = getDragAfterElement(container, e.clientY);
    if (afterElement == null) {
      container.appendChild(draggingElement);
    } else {
      container.insertBefore(draggingElement, afterElement);
    }
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.list-item:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function executeDirectDeleteWord(wordId) {
  const { error } = await supabaseClient.from('words').delete().eq('id', wordId);
  if (error) { showAlertModal("削除に失敗しました"); return; }

  let wrongIds = getSavedWrongIds();
  wrongIds = wrongIds.filter(id => id !== wordId);
  saveWrongIds(wrongIds);
  
  await loadAllAppDataFromSupabase();
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (foundList) quizData = foundList.items;

  const currentLen = quizData.length > 0 ? quizData.length : 1;
  document.getElementById('rangeEnd').value = currentLen;
  if (parseInt(document.getElementById('rangeStart').value) > currentLen) {
    document.getElementById('rangeStart').value = currentLen;
  }
  
  // 🌟【新設】単語が削除されたので、画面上の「苦手問題数」の表示を最新にする
  updateWrongCountLabel();
  
  renderMainList();
  saveViewState();
}

function toggleBulkDeleteMode() {
  isBulkDeleteMode = !isBulkDeleteMode;
  const trigger = document.getElementById('bulkDeleteTriggerBtn');
  const execute = document.getElementById('bulkExecuteBtn');
  const cancel = document.getElementById('bulkCancelBtn');
  
  if (isBulkDeleteMode) {
    trigger.style.display = "none";
    execute.style.display = "inline-block";
    cancel.style.display = "inline-block";
  } else {
    trigger.style.display = "inline-block";
    execute.style.display = "none";
    cancel.style.display = "none";
  }
  renderMainList();
}

async function executeBulkDelete() {
  const checkedBoxes = document.querySelectorAll('#listContainer .bulk-checkbox:checked');
  if (checkedBoxes.length === 0) { showAlertModal("削除する単語が選択されていません。"); return; }

  const idsToDelete = Array.from(checkedBoxes).map(cb => parseInt(cb.value));
  
  const { error } = await supabaseClient.from('words').delete().in('id', idsToDelete);
  if (error) { showAlertModal("まとめて削除に失敗しました"); return; }

  let wrongIds = getSavedWrongIds();
  wrongIds = wrongIds.filter(id => !idsToDelete.includes(id));
  saveWrongIds(wrongIds);
  
  await loadAllAppDataFromSupabase();
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (foundList) quizData = foundList.items;

  const currentLen = quizData.length > 0 ? quizData.length : 1;
  document.getElementById('rangeEnd').value = currentLen;
  if (parseInt(document.getElementById('rangeStart').value) > currentLen) {
    document.getElementById('rangeStart').value = currentLen;
  }

  isBulkDeleteMode = false;
  document.getElementById('bulkDeleteTriggerBtn').style.display = "inline-block";
  document.getElementById('bulkExecuteBtn').style.display = "none";
  document.getElementById('bulkCancelBtn').style.display = "none";
  
  // 🌟【新設】一括削除されたので、画面上の「苦手問題数」の表示を最新にする
  updateWrongCountLabel();
  
  renderMainList();
  saveViewState();
}

function triggerEditWordModal(id, oldQ, oldA) {
  document.getElementById('modalEditQ').value = oldQ;
  document.getElementById('modalEditA').value = oldA;
  
  updateChemPlaceholder(); // 💡 編集画面を開くときにもプレースホルダーを更新
  openModal('editWordModal');

  document.getElementById('modalConfirmEditBtn').onclick = async () => {
    const newQ = document.getElementById('modalEditQ').value.trim();
    const newA = document.getElementById('modalEditA').value.trim();
    if (newQ === "" || newA === "") return;

    const { error } = await supabaseClient.from('words').update({ question: newQ, answer: newA }).eq('id', id);
    if (error) { showAlertModal("単語の更新に失敗しました"); return; }

    closeModal('editWordModal');
    await loadAllAppDataFromSupabase();
    const foundList = appData.find(l => l.listId === currentActiveListId);
    if (foundList) quizData = foundList.items;
    
    renderMainList();
    saveViewState();
  };
}

async function addNewProblem() {
  const qInput = document.getElementById('newQuestion');
  const aInput = document.getElementById('newAnswer');
  if (qInput.value.trim() === "" || aInput.value.trim() === "") return;

  const { error } = await supabaseClient.from('words').insert([
    { 
      room_id: currentActiveListId, 
      question: qInput.value.trim(), 
      answer: aInput.value.trim() 
    }
  ]);

  if (error) { showAlertModal("単語の追加に失敗しました"); return; }

  qInput.value = ""; aInput.value = "";
  
  await loadAllAppDataFromSupabase(); 
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (foundList) quizData = foundList.items;

  renderMainList();

  // 🌟【新設】単語が追加されたら、出題範囲の「終了問目」を最新の総問題数に自動更新する
  if (quizData && quizData.length > 0) {
    const rEnd = document.getElementById('rangeEnd');
    if (rEnd) {
      rEnd.value = quizData.length;
    }
  }

  saveViewState();
  qInput.focus(); 
}

// 💡 過去の validateCounter を今回の新しい「上限丸めルール」に完全統合します！
// 💡 入力された問題番号が、単語帳の最大数を超えないように丸める関数
function validateCounter(inputElement) {
  if (!inputElement || !currentActiveListId) return;
  
  // 1. 現在の単語帳データを取得
  const list = appData.find(l => l.listId === currentActiveListId);
  // 🌟 修正：list.words ではなく、実際のデータ構造である list.items の数を数える
  const total = (list && list.items && list.items.length > 0) ? list.items.length : 1;

  // 2. 入力された値を数値に変換
  let val = parseInt(inputElement.value);

  // 3. 【判定】もし文字だったり、1未満なら「1」にする
  if (isNaN(val) || val < 1) {
    inputElement.value = 1;
  } 
  // 4. 【判定】もし最大数を超えていたら、最大数（total）でストップさせる！
  else if (val > total) {
    inputElement.value = total;
  }
}

function startMemorizeMode() {
  if (!prepareQuestions()) return;
  memoIndex = 0;
  saveViewState();
  navigateTo('#memorize');
}

function showMemoCard() {
  isCardFront = true;
  const card = document.getElementById('bigCard');
  if(!card) return;
  card.classList.remove('back-style');
  document.getElementById('memoProgress').textContent = `暗記カード： ${memoIndex + 1} / ${currentQuestions.length}`;
  card.textContent = currentQuestions[memoIndex].question;

  const prevWrapper = document.getElementById('memoPrevBtnWrapper');
  if(prevWrapper) {
    prevWrapper.style.visibility = (memoIndex === 0) ? "hidden" : "visible";
  }
}

function flipBigCard() {
  const card = document.getElementById('bigCard');
  card.textContent = isCardFront ? currentQuestions[memoIndex].answer : currentQuestions[memoIndex].question;
  card.classList.toggle('back-style', isCardFront);
  isCardFront = !isCardFront;
  saveViewState();
}

function nextMemo() {
  if (memoIndex < currentQuestions.length - 1) { memoIndex++; showMemoCard(); saveViewState(); } 
  else { openModal('memoEndModal'); }
}

function prevMemo() { if (memoIndex > 0) { memoIndex--; showMemoCard(); saveViewState(); } }
function restartMemorize() { closeModal('memoEndModal'); memoIndex = 0; showMemoCard(); saveViewState(); }
function exitMemorize() { closeModal('memoEndModal'); backToMainList(); }

function backToMainList() {
  if (autoNextTimer) clearTimeout(autoNextTimer); 
  navigateTo('#list');
}

function startQuizMode() {
  if (!prepareQuestions()) return;
  quizHistoryLogs = []; 
  lastResultFeedbackHTML = ""; 
  saveViewState();
  navigateTo('#quiz');
}

function retryQuiz(retryMode) {
  if (autoNextTimer) clearTimeout(autoNextTimer);
  
  if (retryMode === 'wrong') {
    const wrongItems = [];
    quizHistoryLogs.forEach(log => {
      if (!log.isCorrect) {
        const match = quizData.find(item => item.question === log.question);
        if (match) wrongItems.push(match);
      }
    });
    if (wrongItems.length === 0) { showAlertModal("間違えた問題はありません！🎉"); return; }
    currentQuestions = wrongItems;
  } else {
    if (!prepareQuestions()) return;
  }
  
  currentIndex = 0;
  quizHistoryLogs = [];
  lastResultFeedbackHTML = "";
  saveViewState();
  navigateTo('#quiz');
  routeView('#quiz'); 
}

// 💡 LocalStorage から苦手IDを取得（型エラーを防ぐため文字列に統一して処理）
function getSavedWrongIds() { 
  const rawData = localStorage.getItem(`chem_wrong_ids_${currentActiveListId}`);
  return rawData ? JSON.parse(rawData).map(id => String(id)) : []; 
}

function saveWrongIds(ids) { 
  // 重複を排除し、すべて文字列に変換して保存
  const uniqueIds = Array.from(new Set(ids.map(id => String(id))));
  localStorage.setItem(`chem_wrong_ids_${currentActiveListId}`, JSON.stringify(uniqueIds)); 
  updateWrongCountLabel(); 
}

// 🌟【バグ修正版】現在の単語帳に「本当に存在する」苦手問題だけを厳密にカウントする
function updateWrongCountLabel() { 
  const lbl = document.getElementById('wrongCountLabel'); 
  if (!lbl) return;

  if (!currentActiveListId) {
    lbl.textContent = "0";
    return;
  }

  // 1. LocalStorageに保存されている苦手IDを取得
  const savedWrongIds = getSavedWrongIds();

  // 2. 現在アクティブな単語帳の「本物の全問題データ」を取得
  const list = appData.find(l => String(l.listId) === String(currentActiveListId));
  const realItems = (list && list.items) ? list.items : [];

  // 3. LocalStorageのIDのうち、「現在の単語帳に実在する問題のID」だけを抽出する
  const validWrongIds = savedWrongIds.filter(id => 
    realItems.some(item => String(item.id) === String(id))
  );

  // 4. もしゴミデータ（削除済みの問題など）が混ざっていたら、LocalStorage側も綺麗に掃除する
  if (savedWrongIds.length !== validWrongIds.length) {
    localStorage.setItem(`chem_wrong_ids_${currentActiveListId}`, JSON.stringify(validWrongIds));
  }

  // 5. 正しい件数を画面に反映
  lbl.textContent = validWrongIds.length; 
}
function toggleModeUI() { 
  const area = document.getElementById('normalConfigArea'); 
  if(area) area.style.display = document.getElementById('modeNormal').checked ? 'block' : 'none'; 
  
  // 🌟【新設】モードが切り替わったら、即座に単語リストも書き換える！
  renderMainList();
}
function prepareQuestions() {
  if (quizData.length === 0) { showAlertModal("問題が登録されていません。"); return false; }
  
  const targetAllRadio = document.getElementById('targetAll');
  if (targetAllRadio && targetAllRadio.checked) {
    const total = quizData.length > 0 ? quizData.length : 1;
    const rStart = document.getElementById('rangeStart');
    const rEnd = document.getElementById('rangeEnd');
    if (rStart) rStart.value = 1;
    if (rEnd) rEnd.value = total;
  }

  let startVal = parseInt(document.getElementById('rangeStart').value) || 1;
  let endVal = parseInt(document.getElementById('rangeEnd').value) || quizData.length;
  if (startVal > endVal) { showAlertModal("出題範囲の開始が終了を上回っています。"); return false; }

  let filtered = document.getElementById('modeNormal').checked ? quizData.slice(startVal - 1, endVal) : quizData.filter(q => getSavedWrongIds().includes(String(q.id)));
  if (filtered.length === 0) { showAlertModal("出題条件に該当する問題がありません。"); return false; }

  // 「答え ➔ 問題」が選ばれている場合
  const isReverse = document.getElementById('dirReverse') && document.getElementById('dirReverse').checked;
  if (isReverse) {
    filtered = filtered.map(item => {
      return {
        id: item.id, // 🌟 ここで確実にIDを維持！
        room_id: item.room_id,
        question: item.answer,   
        answer: item.question    
      };
    });
  }

  if (document.getElementById('orderRandom').checked) {
    for (let i = filtered.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [filtered[i], filtered[j]] = [filtered[j], filtered[i]]; }
  }

  currentQuestions = filtered; currentIndex = 0; wrongQuestions = [];
  return true;
}

function showQuestion() {
  if (autoNextTimer) clearTimeout(autoNextTimer); 
  inputField.value = ""; inputField.disabled = false;
  
  const submitBtn = document.getElementById('submitBtn');
  const resetBtn = document.getElementById('resetBtn');
  if (submitBtn) submitBtn.disabled = false;
  if (resetBtn) resetBtn.disabled = false;

  progressText.textContent = `第 ${currentIndex + 1} 問 / 全 ${currentQuestions.length} 問`;
  document.getElementById('quizBigCardQuestion').textContent = currentQuestions[currentIndex].question;
  
  if (lastResultFeedbackHTML) {
    previousAnswerArea.innerHTML = lastResultFeedbackHTML;
  } else {
    previousAnswerArea.innerHTML = "";
  }
  
  inputField.focus();
}

function resetQuizInput() {
  inputField.value = "";
  inputField.focus();
}

function checkAnswer() {
  if (inputField.disabled) return;

  let userText = inputField.value; 
  let currentQ = currentQuestions[currentIndex]; 
  let correctAnswer = currentQ.answer;
  
  function simplify(t) { return t.replaceAll('+','').replaceAll('⁺','').replaceAll('→','').replaceAll('->','').replaceAll(' ',''); }
  
  let wrongIds = getSavedWrongIds(); // すでに文字列配列として取得される
  let isCorrect = simplify(userText) === simplify(correctAnswer);

  quizHistoryLogs.push({ question: currentQ.question, correctAnswer: correctAnswer, userAns: userText, isCorrect: isCorrect });

  inputField.disabled = true; 
  const submitBtn = document.getElementById('submitBtn');
  const resetBtn = document.getElementById('resetBtn');
  if (submitBtn) submitBtn.disabled = true;
  if (resetBtn) resetBtn.disabled = true;

  // 💡 バグ対策：問題のIDを確実に文字列にする
  const qIdStr = String(currentQ.id);

  if (isCorrect) {
    lastResultFeedbackHTML = `前問の判定: <span class="prev-correct">⭕ 正解</span>（${currentQ.question} ➔ ${correctAnswer}）`;
    wrongIds = wrongIds.filter(id => String(id) !== qIdStr);
  } else {
    lastResultFeedbackHTML = `前問の判定: <span class="prev-wrong">❌ 不正解</span>（${currentQ.question} ➔ 正解: <span style="color:#2196f3;">${correctAnswer}</span>）`;
    wrongQuestions.push(currentQ);
    
    // 💡 確実に文字列として存在チェックをしてから追加
    if (!wrongIds.includes(qIdStr)) {
      wrongIds.push(qIdStr);
    }
  }
  
  saveWrongIds(wrongIds); // この中で保存と「wrongCountLabel」の更新が走る
  saveViewState();
  
  autoNextTimer = setTimeout(() => {
    nextQuestion();
  }, 100);
}

function nextQuestion() {
  currentIndex++;
  if (currentIndex < currentQuestions.length) { 
    saveViewState();
    showQuestion(); 
  } else { 
    saveViewState();
    navigateTo('#result'); 
  }
}

function showQuizReviewSummary() {
  const wrongCount = quizHistoryLogs.filter(l => !l.isCorrect).length;
  const retryWrongBtn = document.getElementById('retryWrongBtn');
  if (retryWrongBtn) {
    retryWrongBtn.style.display = wrongCount > 0 ? "inline-block" : "none";
  }
  document.getElementById('quizFinalScore').textContent = `🏁 テスト終了！ 正解数: ${quizHistoryLogs.filter(l => l.isCorrect).length} / ${quizHistoryLogs.length}`;
  switchReviewTab('all'); 
}

function switchReviewTab(tabType) {
  const tabAll = document.getElementById('tabAllBtn');
  const tabWrong = document.getElementById('tabWrongBtn');
  if (tabType === 'all') {
    tabAll.className = "btn btn-action"; tabWrong.className = "btn btn-sub";
    renderReviewRows(quizHistoryLogs);
  } else {
    tabAll.className = "btn btn-sub"; tabWrong.className = "btn btn-action";
    renderReviewRows(quizHistoryLogs.filter(log => !log.isCorrect));
  }
}

function renderReviewRows(logsArray) {
  const tbody = document.getElementById('reviewTableBody');
  if(!tbody) return;
  tbody.innerHTML = "";
  if (logsArray.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:gray; padding:20px;">該当する問題はありません。</td></tr>`;
    return;
  }
  logsArray.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="${log.isCorrect ? 'status-ok' : 'status-ng'}">${log.isCorrect ? '⭕ 正解' : '❌ 不正解'}</td>
      <td><b>${log.question}</b></td>
      <td style="color:#2196f3; font-weight:bold;">${log.correctAnswer}</td>
    `;
    tbody.appendChild(tr);
  });
}

// 現在開いている単語帳に「化学」タグがついているか判定する関数
function hasChemTag() {
  if (!currentActiveListId) return false;
  const currentList = appData.find(l => l.listId === currentActiveListId);
  if (!currentList || !currentList.listTags) return false;
  
  // カンマ区切りのタグをバラバラにして、「化学」が含まれているか調べる
  const tagsArray = currentList.listTags.split(',').map(t => t.trim());
  return tagsArray.includes('化学');
}

function initInputFieldAutoConversion(targetInput) {
  if (!targetInput) return;
  
  let isShiftPressed = false;
  targetInput.addEventListener('keydown', function(e) {
    if (e.key === 'Shift') isShiftPressed = true;
  });
  targetInput.addEventListener('keyup', function(e) {
    if (e.key === 'Shift') isShiftPressed = false;
  });

  targetInput.addEventListener('input', function() {
    if (!hasChemTag()) return;

    let start = targetInput.selectionStart; 
    let val = targetInput.value;
    
    // 1. 数字のみリセット
    const revertMap = {
      '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9',
      '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'
    };
    val = val.split('').map(c => revertMap[c] || c).join('');

    // 全角➔半角処理（ここで「ー」も通常のマイナス「-」に変換されます）
    val = val.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    val = val.replaceAll('；', ';').replaceAll('ー', '-').replaceAll('．', '.').replaceAll(' ”', '"').replaceAll(' ', ' ');
    val = val.replaceAll('＋', '+');

    const shiftNumbers = { '!': '1', '"': '2', '#': '3', '$': '4', '%': '5', '&': '6', "'": '7' };
    for (let key in shiftNumbers) { val = val.replaceAll(key, shiftNumbers[key]); }
    
    // 2. キー置換
    val = val.replaceAll(';', '⁺');
    val = val.replaceAll('-', '⁻');
    val = val.replaceAll('.', '･').replaceAll(' ', '→');
    val = val.toUpperCase();
    
    val = val.replaceAll('E-', 'e-');
    val = val.replaceAll('E⁺', 'e⁺');

    // 元素記号処理
    const elements2char = ['He','Li','Be','Ne','Na','Mg','Al','Si','Cl','Ar','K','Ca','Sc','Ti','V','Cr','Mn','Fe','Ni','Cu','Zn','Ga','Ge','As','Se','Br','Kr','Rb','Sr','Y','Zr','Nb','Mo','Tc','Ru','Rh','Pd','Ag','Cd','In','Sn','Sb','Te','I','Xe','Cs','Ba','Pt','Au','Hg','Pb','Bi','Po','At','Rn','Fr','Ra','U'];
    elements2char.forEach(el => { val = val.replaceAll(el.toUpperCase(), el); });
    
    // 🌟【新設】1価の多原子イオンの先回り処理
    // 誤って数字が上付き（価数）に化けないよう、先に数字を下付きに固定してしまいます
    const polyIons = [
      { reg: /HCO3([⁺⁻])/g, rep: 'HCO₃$1' },
      { reg: /NO3([⁺⁻])/g, rep: 'NO₃$1' },
      { reg: /HSO4([⁺⁻])/g, rep: 'HSO₄$1' },
      { reg: /ClO2([⁺⁻])/g, rep: 'ClO₂$1' },
      { reg: /ClO3([⁺⁻])/g, rep: 'ClO₃$1' },
      { reg: /ClO4([⁺⁻])/g, rep: 'ClO₄$1' },
      { reg: /MnO4([⁺⁻])/g, rep: 'MnO₄$1' },
      { reg: /NH4([⁺⁻])/g, rep: 'NH₄$1' } // 陽イオンのアンモニウムも対策！
    ];
    polyIons.forEach(item => { val = val.replace(item.reg, item.rep); });

    // 3. イオン（価数の上付き数字）の変換
    // （すでに上記で下付き文字「₃」などに変換された部分は、ここの普通の数字の判定をスルーします）
    val = val.replace(/([A-Za-z)\]])(\d+)([⁺⁻])/g, function(match, char, nums, sign) {
      let subPart = "";
      let supPart = "";
      
      if (nums.length > 1) {
        subPart = nums.slice(0, -1);
        supPart = nums.slice(-1);
      } else {
        supPart = nums;
      }
      
      const subMap = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉'};
      const supMap = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
      
      let convSub = subPart.split('').map(c => subMap[c] || c).join('');
      let convSup = supPart.split('').map(c => supMap[c] || c).join('');
      
      return char + convSub + convSup + sign;
    });

    // 4. 残った通常の数字（分子式などの下付き文字）を変換
    let newVal = "";
    for (let i = 0; i < val.length; i++) {
      let char = val[i];
      if (char >= '0' && char <= '9') {
        let shouldSub = false; 
        if (newVal.length > 0) { 
          let prev = newVal[newVal.length - 1]; 
          if (/[A-Za-z)\]₀₁₂₃₄₅₆₇₈₉]/.test(prev)) shouldSub = true; 
          if (/[ +\-→➔⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻･]/.test(prev)) shouldSub = false; 
        }
        if (shouldSub) { 
          const subs = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉'}; 
          char = subs[char]; 
        }
      }
      newVal += char;
    }

    newVal = newVal.replaceAll('e-', 'e⁻').replaceAll('e+', 'e⁺');
    newVal = newVal.replaceAll('E⁺', 'e⁺').replaceAll('E⁻', 'e⁻');
    
    if (targetInput.value !== newVal) { 
      targetInput.value = newVal; 
      targetInput.selectionStart = targetInput.selectionEnd = start; 
    }
  });
}

inputField.addEventListener('keydown', function(event) {
  if (event.key === 'Enter') { 
    if (event.isComposing) return; 
    event.preventDefault(); 
    checkAnswer(); 
  }
});

// タグの編集・保存
async function editListTagsInline() {
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (!foundList) return;
  
  const newTags = prompt("タグをカンマ( , )区切りで入力してください\n（例: 化学, 定期テスト, 1学期）", foundList.listTags);
  if (newTags === null) return; 
  
  const { error } = await supabaseClient.from('rooms').update({ tags: newTags }).eq('id', currentActiveListId);
  if (error) { showAlertModal("タグの保存に失敗しました"); return; }

  foundList.listTags = newTags;
  await loadAllAppDataFromSupabase();
  saveViewState();
  routeView('#list'); 
}

// =========================================================
// ⚠️ この上には、これまでのコード（Supabase設定、単語の追加、クイズ処理など）がそのまま入ります
// =========================================================

// 💡 名前とタグをまとめて編集・保存するポップアップ処理
function openEditListInfoModal() {
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (!foundList) return;

  // 1. 現在の名前とタグをポップアップの入力欄にセットする
  document.getElementById('modalEditListName').value = foundList.listName;
  document.getElementById('modalEditListTags').value = foundList.listTags || "";

  // 2. ポップアップを表示する
  openModal('editListInfoModal');

  // 3. 「保存する」ボタンが押されたときの処理
  document.getElementById('modalConfirmListInfoBtn').onclick = async () => {
    const newName = document.getElementById('modalEditListName').value.trim();
    const newTags = document.getElementById('modalEditListTags').value.trim();

    if (newName === "") {
      showAlertModal("単語帳の名前は空にできません。"); // ✨ alertから書き換え
      return;
    }

    // Supabaseのデータを更新
    const { error } = await supabaseClient
      .from('rooms')
      .update({ title: newName, tags: newTags })
      .eq('id', currentActiveListId);

    if (error) { 
      showAlertModal("情報の保存に失敗しました: " + error.message); // ✨ alertから書き換え
      return; 
    }

    // アプリ内のデータも更新
    foundList.listName = newName;
    foundList.listTags = newTags;
    document.getElementById('currentListTitle').textContent = newName;

    // 最新のデータを読み直して画面に反映
    await loadAllAppDataFromSupabase();
    updateChemPlaceholder();
    saveViewState();
    routeView('#list'); 
    closeModal('editListInfoModal');
  };
}

// 💡 「化学」タグの有無で入力欄のプレースホルダーとヘルプボタンを切り替える関数
// 💡 「化学」タグの有無で、入力欄のヒント文字やプレースホルダー、ヘルプボタンを切り替える関数
function updateChemPlaceholder() {
  if (!currentActiveListId) return;
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (!foundList) return;

  // 「化学」タグが含まれているかチェック
  const hasChem = foundList.listTags && foundList.listTags.split(',').map(t => t.trim()).includes('化学');
  
  // 1. 入力欄の薄い文字（プレースホルダー）の切り替え
  const placeholderText = hasChem ? "答え（自動変換が適用されます）" : "答え";
  const newAnswerInput = document.getElementById('newAnswer');
  const modalEditAInput = document.getElementById('modalEditA');
  if (newAnswerInput) newAnswerInput.placeholder = placeholderText;
  if (modalEditAInput) modalEditAInput.placeholder = placeholderText;

  // 2. 「💡 入力ヒントを見る」の文字の表示/非表示
  const hintTextAdd = document.getElementById('hintTextAdd');
  const hintTextEdit = document.getElementById('hintTextEdit');
  if (hintTextAdd) hintTextAdd.style.display = hasChem ? 'inline' : 'none';
  if (hintTextEdit) hintTextEdit.style.display = hasChem ? 'inline' : 'none';

  // 3. 右側の「❓ 自動変換とは？」ボタンの表示/非表示
  let wrapper = document.getElementById('chemHelpBtnWrapper');
  if (hasChem) {
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = 'chemHelpBtnWrapper';
      wrapper.style.cssText = 'display: flex; justify-content: flex-end; width: 100%; margin-bottom: 8px;';

      const helpBtn = document.createElement('button');
      helpBtn.id = 'chemHelpBtn';
      helpBtn.textContent = '❓ 自動変換とは？';
      helpBtn.style.cssText = 'background-color: #ffffff; color: #2196f3; border: 1px solid #2196f3; border-radius: 4px; padding: 5px 12px; font-size: 0.85rem; cursor: pointer; font-family: inherit; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.05); transition: background 0.2s;';
      
      helpBtn.onmouseenter = () => { helpBtn.style.backgroundColor = '#e3f2fd'; };
      helpBtn.onmouseleave = () => { helpBtn.style.backgroundColor = '#ffffff'; };
      helpBtn.onclick = () => { showChemHelpModal(); };
      
      wrapper.appendChild(helpBtn);

      const rightColumn = document.querySelector('.right-column');
      if (rightColumn) {
        const whiteBox = rightColumn.querySelector('.config-box');
        if (whiteBox) rightColumn.insertBefore(wrapper, whiteBox);
      }
    }
    wrapper.style.display = 'flex';
  } else {
    if (wrapper) wrapper.style.display = 'none';
  }
}

// 💡 「自動変換とは？」ボタンを押した時に、すべての変換ルールを網羅した説明を表示する関数
function showChemHelpModal() {
  let chemModal = document.getElementById('chemHelpModal');
  
  if (!chemModal) {
    chemModal = document.createElement('div');
    chemModal.id = 'chemHelpModal';
    chemModal.className = 'modal-overlay';
    chemModal.style.cssText = 'display: flex; justify-content: center; align-items: flex-start; padding-top: 5vh; overflow-y: auto;';

    // ✨ ドラッグ誤作動防止の処理
    let isChemModalMousedown = false;
    chemModal.onmousedown = function(e) { isChemModalMousedown = (e.target === this); };
    chemModal.onclick = function(e) { if (e.target === this && isChemModalMousedown) closeChemHelpModal(); };
    
    const modalBox = document.createElement('div');
    modalBox.className = 'modal-box';
    modalBox.style.cssText = 'max-width: 550px; text-align: left; margin-bottom: 5vh;';
    
    modalBox.innerHTML = `
      <h3 style="text-align: center; color: #2196f3; margin-top: 0; margin-bottom: 18px; border-bottom: 2px solid #e3f2fd; padding-bottom: 10px;">🧪 化学式・イオン自動変換マニュアル</h3>
      
      <p style="font-size: 0.85rem; color: #666; margin-bottom: 15px;">
        「化学」タグがあるリストでは、キーボードで以下のように打つだけで、自動的に綺麗な化学表記へ変換されます。
      </p>
      
      <div style="overflow-x: auto; width: 100%;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-bottom: 20px; min-width: 420px;">
          <thead>
            <tr style="border-bottom: 2px solid #ddd; background-color: #f9fafb;">
              <th style="padding: 8px; text-align: left; color:#777;">入力したい文字</th>
              <th style="padding: 8px; text-align: left; color:#777;">キーの打ち方</th>
              <th style="padding: 8px; text-align: left; color:#777;">入力例</th>
              <th style="padding: 8px; text-align: left; color:#2196f3;">画面の表示</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px;"><b>元素記号</b></td><td style="padding: 8px;">小文字のままでOK</td><td style="padding: 8px; color: #666;">na</td><td style="padding: 8px; color: #2196f3;"><b>Na</b></td></tr>
            <tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px;"><b>下付き数字</b></td><td style="padding: 8px;">元素の後に数字</td><td style="padding: 8px; color: #666;">c6h12o6</td><td style="padding: 8px; color: #2196f3;"><b>C₆H₁₂O₆</b></td></tr>
            <tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px;"><b>イオン (⁺)</b></td><td style="padding: 8px;"><b>;</b> (セミコロン)</td><td style="padding: 8px; color: #666;">ca2;</td><td style="padding: 8px; color: #2196f3;"><b>Ca²⁺</b></td></tr>
            <tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px;"><b>イオン (⁻)</b></td><td style="padding: 8px;"><b>-</b> (マイナス)</td><td style="padding: 8px; color: #666;">so42-</td><td style="padding: 8px; color: #2196f3;"><b>SO₄²⁻</b></td></tr>
            <tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px;"><b>矢印 (→)</b></td><td style="padding: 8px;"><b>スペースキー</b></td><td style="padding: 8px; color: #666;">(空白)</td><td style="padding: 8px; color: #2196f3;"><b>→</b></td></tr>
            <tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px;"><b>中点 (･)</b></td><td style="padding: 8px;"><b>.</b> (ピリオド)</td><td style="padding: 8px; color: #666;">.</td><td style="padding: 8px; color: #2196f3;"><b>･</b></td></tr>
            <tr><td style="padding: 8px;"><b>反応の (+)</b></td><td style="padding: 8px;"><b>+</b> はそのまま</td><td style="padding: 8px; color: #666;">+</td><td style="padding: 8px; color: #2196f3;"><b>+</b></td></tr>
          </tbody>
        </table>
      </div>
      
      <p style="font-size: 0.8rem; color: #666; margin: 0 0 15px 0; line-height: 1.4;">
        ※ <b>物質の前の数字（係数）</b>は大文字のまま小さくなりません。<br>
        （例: <code>2H2 + O2 ➔ 2H₂ + O₂ ➔ 2H₂O</code>）
      </p>
      
      <div class="modal-buttons">
        <button type="button" onclick="closeChemHelpModal()" class="btn btn-action" style="width: 100%; background-color: #2196f3; padding: 12px; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">確認しました！</button>
      </div>
    `;
    
    chemModal.appendChild(modalBox);
    document.body.appendChild(chemModal);
  }
  
  chemModal.style.display = 'flex';
}

// 💡 モーダルを閉じる関数
function closeChemHelpModal() {
  const chemModal = document.getElementById('chemHelpModal');
  if (chemModal) {
    chemModal.style.display = 'none';
  }
}

// 💡 ブラウザ標準の showAlertModal() の代わりに、アプリ専用の綺麗なポップアップを出す共通関数
function showAlertModal(message) {
  const textElem = document.getElementById('alertModalText');
  if (textElem) {
    textElem.textContent = message;
    openModal('alertModal');
  } else {
    showAlertModal(message); // 万が一HTMLに要素がなければ通常のalertで代用
  }
}

// 🌟 画面の暗い背景（modal-overlay）をクリックしたときにキャンセルする共通処理（ドラッグ誤作動防止版）
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  let isOverlayMousedown = false;

  // 暗い背景部分でマウスを「押し込んだ」かチェック
  overlay.addEventListener('mousedown', function(e) {
    isOverlayMousedown = (e.target === this);
  });

  // マウスを「離した」ときの処理
  overlay.addEventListener('click', function(e) {
    // 暗い背景で押し始めて、かつ暗い背景で離したときだけ閉じる
    if (e.target === this && isOverlayMousedown) {
      const modalId = this.id;
      if (modalId && typeof closeModal === 'function') {
        closeModal(modalId);
      }
    }
  });
});

// =========================================================
// 💡 【新機能】出題対象の「すべて出題 / 範囲指定」を切り替える処理
// =========================================================

// ① ラジオボタンの選択に合わせて、範囲指定エリアの表示/非表示を切り替える関数
function toggleCustomSettingsUI() {
  const isCustom = document.getElementById('targetCustom').checked;
  const customArea = document.getElementById('customSettingsArea');
  if (customArea) {
    customArea.style.display = isCustom ? 'block' : 'none';
  }
}
// 💡【新設】「単語をまとめて削除」ボタンを押したときに、チェックボックスの表示を切り替える関数
function toggleBulkDeleteMode() {
  // モードを反転させる
  isBulkDeleteMode = !isBulkDeleteMode;

  const triggerBtn = document.getElementById('bulkDeleteTriggerBtn');
  const executeBtn = document.getElementById('bulkExecuteBtn');
  const cancelBtn = document.getElementById('bulkCancelBtn');

  // ボタン類の表示・非表示を切り替え
  if (isBulkDeleteMode) {
    if (triggerBtn) triggerBtn.style.display = "none";
    if (executeBtn) executeBtn.style.display = "inline-block";
    if (cancelBtn) cancelBtn.style.display = "inline-block";
  } else {
    if (triggerBtn) triggerBtn.style.display = "inline-block";
    if (executeBtn) executeBtn.style.display = "none";
    if (cancelBtn) cancelBtn.style.display = "none";
  }

  // リストを再描画して、ゴミ箱マークとチェックボックスを入れ替える
  renderMainList();
}