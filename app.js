const SUPABASE_URL = 'https://otwqwuidhkbtfniwpzvf.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90d3F3dWlkaGtidGZuaXdwenZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzOTA0MjYsImV4cCI6MjA5Njk2NjQyNn0.dtPkiYdqo011OpytX6nCvMqiOzrdpEVZ8oj6NXPIsOE'; 

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 📦 アプリ用変数
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

// 🛠️ 丸数字変換用の共通配列（最大15問、超過時は自動フォールバック）
const CIRCLE_NUMBERS = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮'];

// 便利な要素取得補助関数
function getElem(id) { return document.getElementById(id); }

// ==========================================
// 🚀 画面読み込み時の初期化 (エントリーポイント)
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  const chemInput = document.getElementById('chemInput');
  const newAnswer = document.getElementById('newAnswer');
  const singleAnswerInput = document.getElementById('singleAnswerInput');
  const modalEditA = document.getElementById('modalEditA');

  if (chemInput) initInputFieldAutoConversion(chemInput);  
  if (newAnswer) initInputFieldAutoConversion(newAnswer);  
  if (singleAnswerInput) initInputFieldAutoConversion(singleAnswerInput);
  if (modalEditA) initInputFieldAutoConversion(modalEditA); 

  window.addEventListener('hashchange', () => {
    routeView(window.location.hash);
  });

  try {
    await loadAllAppDataFromSupabase();
    loadViewStateOnly();
  } catch (e) {
    console.error("初期データ読込エラー:", e);
  } finally {
    routeView(window.location.hash || '#top');
  }
});

function navigateTo(hash) {
  window.location.hash = hash;
}

// 🧪【新旧データ共存版】Supabaseから親（問題）と子（小問）をセットで取得する
async function loadAllAppDataFromSupabase() {
  const { data: rooms, error: roomError } = await supabaseClient
    .from('rooms')
    .select('*')
    .order('created_at', { ascending: true });
    
  if (roomError) { console.error("ルーム取得エラー:", roomError); return; }

  const { data: words, error: wordError } = await supabaseClient
  .from('words')
  .select('id, room_id, question, answer, sort_order, is_unordered, disable_chem_convert, sub_items(*)')  .order('sort_order', { ascending: true });

  if (wordError) { console.error("単語・小問取得エラー:", wordError); return; }

  appData = rooms.map(room => {
    const matchedItems = words ? words.filter(w => w.room_id === room.id) : [];
    
    return {
      listId: room.id,
      listName: room.title,
      listTags: room.tags || "", 
      items: matchedItems.map(w => {
        let finalSubItems = w.sub_items ? w.sub_items.sort((a, b) => a.sort_order - b.sort_order) : [];
        
        // 旧仕様（単一答え）のデータがある場合のフォールバック
        if (finalSubItems.length === 0 && w.answer) {
          finalSubItems = [{
            id: `old_${w.id}`,
            word_id: w.id,
            sub_question: "答え", 
            answer: w.answer,
            sort_order: 0
          }];
        }

        return {
          id: w.id,
          question: w.question, 
          is_unordered: w.is_unordered || false,
          disable_chem_convert: w.disable_chem_convert || false,
          sub_items: finalSubItems 
        };
      })
    };
  });

  console.log("📦 データの同期が完了しました", appData);
}

function routeView(hash) {
  document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
  isBulkDeleteMode = false; 
  
  // 入力フォームの中身をきれいにリセットする
  const newQuestion = document.getElementById('newQuestion');
  const singleAnswerInput = document.getElementById('singleAnswerInput');
  const subItemsContainer_Add = document.getElementById('subItemsContainer_Add');
  const newListName = document.getElementById('newListName');
  
  if (newQuestion) newQuestion.value = "";
  if (singleAnswerInput) singleAnswerInput.value = "";
  if (newListName) newListName.value = "";
  if (subItemsContainer_Add) subItemsContainer_Add.innerHTML = ""; 

  if (document.getElementById('bulkDeleteTriggerBtn')) document.getElementById('bulkDeleteTriggerBtn').style.display = "inline-block";
  if (document.getElementById('bulkExecuteBtn')) document.getElementById('bulkExecuteBtn').style.display = "none";
  if (document.getElementById('bulkCancelBtn')) document.getElementById('bulkCancelBtn').style.display = "none";

  if (!hash || hash.startsWith('#top')) {
    if (document.getElementById('topView')) document.getElementById('topView').style.display = 'block';
    renderTopView();
  } 
  else if (hash.startsWith('#list')) {
    if (!currentActiveListId) { navigateTo('#top'); return; }
    if (document.getElementById('mainListView')) document.getElementById('mainListView').style.display = 'block';
    const foundList = appData.find(l => l.listId === currentActiveListId);
    if (foundList) {
      document.getElementById('currentListTitle').textContent = foundList.listName;
      const tArray = foundList.listTags ? foundList.listTags.split(',').map(t=>t.trim()).filter(t=>t) : [];
      const tagsContainer = document.getElementById('currentListTags');
      if (tagsContainer) {
        if (tArray.length > 0) {
          tagsContainer.style.marginBottom = '15px';
          tagsContainer.innerHTML = tArray.map(t => `<span class="list-tag-badge">#${t}</span>`).join(' ');
        } else {
          tagsContainer.style.marginBottom = '0px';
          tagsContainer.innerHTML = '';
        }
      }
      
      renderMainList();
      updateChemPlaceholder(); 
    }
  } 
  else if (hash.startsWith('#memorize')) {
    if (!currentActiveListId || currentQuestions.length === 0) { navigateTo('#list'); return; }
    if (document.getElementById('memorizeView')) document.getElementById('memorizeView').style.display = 'block';
    showMemoCard();
  } 
  else if (hash.startsWith('#quiz')) {
    if (!currentActiveListId || currentQuestions.length === 0) { navigateTo('#list'); return; }
    if (document.getElementById('quizView')) document.getElementById('quizView').style.display = 'block';
    if (document.getElementById('quizPlayArea')) document.getElementById('quizPlayArea').style.display = 'block';
    if (document.getElementById('quizResultArea')) document.getElementById('quizResultArea').style.display = 'none';
    showQuestion();
  } 
  else if (hash.startsWith('#result')) {
    if (!currentActiveListId) { navigateTo('#top'); return; }
    if (document.getElementById('quizView')) document.getElementById('quizView').style.display = 'block';
    if (document.getElementById('quizPlayArea')) document.getElementById('quizPlayArea').style.display = 'none';
    // 💡 以下の行のタイポを修正しました
    if (document.getElementById('quizResultArea')) document.getElementById('quizResultArea').style.display = 'block';
    showQuizReviewSummary();
  }
}

function closeModal(id) { if (document.getElementById(id)) document.getElementById(id).style.display = 'none'; }

function saveViewState() {
  const state = {
    listId: currentActiveListId,
    modeType: document.getElementById('modeWrongList') && document.getElementById('modeWrongList').checked ? 'wrong' : 'normal',
    rangeStart: document.getElementById('rangeStart') ? document.getElementById('rangeStart').value : "1",
    rangeEnd: document.getElementById('rangeEnd') ? document.getElementById('rangeEnd').value : "1",
    orderType: document.getElementById('orderRandom') && document.getElementById('orderRandom').checked ? 'random' : 'normal',
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
      else if (document.getElementById('modeNormal')) document.getElementById('modeNormal').checked = true;
      toggleModeUI();
    }
    if (document.getElementById('rangeStart')) document.getElementById('rangeStart').value = state.rangeStart || 1;
    if (document.getElementById('rangeEnd')) document.getElementById('rangeEnd').value = state.rangeEnd || (quizData.length > 0 ? quizData.length : 1);
    
    if (document.getElementById('orderRandom')) {
      if (state.orderType === 'random') document.getElementById('orderRandom').checked = true;
      else if (document.getElementById('orderNormal')) document.getElementById('orderNormal').checked = true;
    }
    
    if (document.getElementById('dirReverse')) {
      if (state.directionType === 'reverse') document.getElementById('dirReverse').checked = true;
      else if (document.getElementById('dirNormal')) document.getElementById('dirNormal').checked = true;
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
      <span class="list-count-badge">${list.items ? list.items.length : 0} 問収録</span>
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
  if (document.getElementById('deleteModalText')) document.getElementById('deleteModalText').innerHTML = `本当に単語帳<b>「${listName}」</b>を丸ごと削除してもよろしいですか？<br>この操作は取り消せません。`;
  openModal('deleteModal');
  
  if (document.getElementById('modalConfirmDeleteBtn')) {
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
}

async function createNewList() {
  const input = document.getElementById('newListName');
  if (!input) return;
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
    quizData = foundList.items || [];

    const modeNormalRadio = document.getElementById('modeNormal');
    if (modeNormalRadio) {
      modeNormalRadio.checked = true; 
    }
    toggleModeUI(); 

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
  if (document.getElementById('currentListTitle')) document.getElementById('currentListTitle').textContent = trimmed;
  await loadAllAppDataFromSupabase();
  saveViewState();
}

// 🌟【小問を①で表示対応】メインリスト一覧画面
function renderMainList() {
  const container = document.getElementById('listContainer');
  if (!container) return;
  container.innerHTML = "";

  if (!quizData || quizData.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:gray; padding:20px;">問題が登録されていません。</div>`;
    return;
  }

  const isWrongMode = document.getElementById('modeWrongList')?.checked;
  
  const displayItems = isWrongMode 
    ? quizData.filter(item => getSavedWrongIds().includes(String(item.id)))
    : quizData;

  if (displayItems.length === 0 && isWrongMode) {
    container.innerHTML = `<div style="text-align:center; color:#009688; padding:20px; font-weight:bold;">🔥 現在、苦手な問題はありません！素晴らしい！🎉</div>`;
    return;
  }

  const showCheckbox = (typeof isBulkDeleteMode !== 'undefined' && isBulkDeleteMode);

  displayItems.forEach((item) => {
    const originalNum = quizData.findIndex(q => String(q.id) === String(item.id)) + 1;
    const div = document.createElement('div');
    div.className = 'list-item';
    
    // 💡 【修正】一括削除モードの時はドラッグ（並び替え）を無効化する
    if (!isWrongMode && !showCheckbox) {
      div.draggable = true;
      div.dataset.id = item.id;
      setupDragAndDropEvents(div);
    } else {
      div.draggable = false;
    }

    // 💡 【追加】一括削除モードの時だけ、行全体に「クリックでチェックをトグルする」イベントを付与
    if (showCheckbox) {
      div.style.cursor = 'pointer'; // 見た目は変えず、触れることを示すカーソルに
      div.onclick = (e) => {
        // ゴミ箱ボタンやチェックボックス自体をクリックした時の二重動作を防止
        if (e.target.closest('.direct-delete-btn') || e.target.closest('.bulk-checkbox')) return;
        
        const cb = div.querySelector('.bulk-checkbox');
        if (cb) {
          cb.checked = !cb.checked;
        }
      };
    }

    const subItems = item.sub_items || [];
    let subItemsHTML = "";
    
    if (subItems.length > 1) {
      subItemsHTML = `<div class="item-sub-list" style="margin-top: 6px; font-size: 0.85rem; color: #555; background: #fafafa; padding: 6px; border-radius: 4px; width: 100%;">`;
      subItems.forEach((sub, subIdx) => {
        const numLabel = CIRCLE_NUMBERS[subIdx] || `(${subIdx + 1})`;
        subItemsHTML += `
          <div style="margin-bottom: 4px; display:flex; justify-content:space-between; gap: 10px;">
            <span style="font-weight:bold; color:#666;">${numLabel} ${sub.sub_question}</span>
            <span style="color:#2196f3; font-weight:bold;">➔ ${sub.answer}</span>
          </div>
        `;
      });
      subItemsHTML += `</div>`;
    } else if (subItems.length === 1) {
      subItemsHTML = `<span class="list-a" style="margin-left: 10px; color: #2196f3; font-weight: bold;">${subItems[0].answer}</span>`;
    } else {
      subItemsHTML = `<span class="list-a" style="margin-left: 10px; color: #aaa; font-size:0.85rem;">※小問なし</span>`;
    }

    const isSingle = subItems.length <= 1;

    // 💡 【修正】一括削除モードの時は、テキストブロック単体の onclick（編集モーダルを開く処理）を無効化する
    const textBlockOnclick = showCheckbox ? "" : `triggerEditWordModal('${item.id}')`;

    div.innerHTML = `
      <div style="display: flex; align-items: ${isSingle ? 'center' : 'flex-start'}; justify-content: space-between; width: 100%; gap: 10px;">
        <div class="list-num" style="${isSingle ? '' : 'margin-top: 2px;'}">${originalNum}</div>
        <div class="list-text-block" style="flex: 1; cursor: pointer; display: ${isSingle ? 'flex' : 'block'}; justify-content: space-between; align-items: center;" onclick="${textBlockOnclick}">
          <span class="list-q" style="font-weight: bold; font-size: 1.05rem;">${item.question}</span>
          ${subItemsHTML}
        </div>
        <div class="list-actions-right" style="display: flex; align-items: center; gap: 5px;">
          <input type="checkbox" class="bulk-checkbox" value="${item.id}" style="display: ${showCheckbox ? 'block' : 'none'};">
          <button class="direct-delete-btn" onclick="executeDirectDeleteWord('${item.id}')" style="display: ${showCheckbox ? 'none' : 'block'}; background: none; border: none; cursor: pointer;">🗑️</button>
        </div>
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

  element.addEventListener('dragend', async () => {
    element.classList.remove('dragging');
    
    const container = document.getElementById('listContainer');
    const items = [...container.querySelectorAll('.list-item')];
    
    quizData = items.map(el => quizData.find(q => String(q.id) === String(el.dataset.id))).filter(Boolean);

    const foundList = appData.find(l => l.listId === currentActiveListId);
    if (foundList) {
      foundList.items = [...quizData];
    }

    renderMainList();
    saveViewState();

    try {
      const promises = quizData.map((item, index) => {
        return supabaseClient
          .from('words') 
          .update({ sort_order: index }) 
          .eq('id', item.id);
      });
      await Promise.all(promises);
    } catch (error) {
      console.error("並び替えの保存に失敗しました:", error);
    }
  });

  const container = document.getElementById('listContainer');
  if (container) {
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
  showDeleteConfirmModal("この問題を削除してもよろしいですか？", async () => {
    const { error } = await supabaseClient.from('words').delete().eq('id', wordId);
    if (error) { showAlertModal("削除に失敗しました"); return; }

    let wrongIds = getSavedWrongIds();
    wrongIds = wrongIds.filter(id => id !== wordId);
    saveWrongIds(wrongIds);
    
    quizData = quizData.filter(item => String(item.id) !== String(wordId));
    const foundList = appData.find(l => l.listId === currentActiveListId);
    if (foundList) {
      foundList.items = quizData;
    }

    const currentLen = quizData.length > 0 ? quizData.length : 1;
    if (document.getElementById('rangeEnd')) document.getElementById('rangeEnd').value = currentLen;
    if (document.getElementById('rangeStart') && parseInt(document.getElementById('rangeStart').value) > currentLen) {
      document.getElementById('rangeStart').value = currentLen;
    }
    
    updateWrongCountLabel();
    renderMainList();
    saveViewState();
  });
}

async function executeBulkDelete() {
  const checkedBoxes = document.querySelectorAll('#listContainer .bulk-checkbox:checked');
  if (checkedBoxes.length === 0) { showAlertModal("削除する問題が選択されていません。"); return; }

  // 💡 【修正】1問削除と同じアプリ独自のカスタムポップアップ（モーダル）を表示します
  showDeleteConfirmModal(`選択された ${checkedBoxes.length} 件の問題を一括削除しますか？`, async () => {
    
    // 👇 ここから先は、ポップアップで「削除する」を押したときに動く処理です
    const idsToDelete = Array.from(checkedBoxes).map(cb => parseInt(cb.value));
    const idsToDeleteStr = idsToDelete.map(String);
    
    const { error } = await supabaseClient.from('words').delete().in('id', idsToDelete);
    if (error) { showAlertModal("まとめて削除に失敗しました"); return; }

    let wrongIds = getSavedWrongIds();
    wrongIds = wrongIds.filter(id => !idsToDeleteStr.includes(id));
    saveWrongIds(wrongIds);
    
    quizData = quizData.filter(item => !idsToDelete.includes(item.id));
    const foundList = appData.find(l => l.listId === currentActiveListId);
    if (foundList) {
      foundList.items = quizData;
    }

    const currentLen = quizData.length > 0 ? quizData.length : 1;
    if (document.getElementById('rangeEnd')) document.getElementById('rangeEnd').value = currentLen;
    if (document.getElementById('rangeStart') && parseInt(document.getElementById('rangeStart').value) > currentLen) {
      document.getElementById('rangeStart').value = currentLen;
    }

    toggleBulkDeleteMode();
    updateWrongCountLabel();
    renderMainList();
    saveViewState();
  });
}

function toggleModeUI() { 
  const area = document.getElementById('normalConfigArea'); 
  if(area) area.style.display = document.getElementById('modeNormal').checked ? 'block' : 'none'; 
  renderMainList();
}

function toggleSubItemFormUI() {
  const mode = document.querySelector('input[name="subItemMode"]:checked').value;
  const singleCont = document.getElementById('singleAnswerContainer');
  const multiCont = document.getElementById('multiSubItemContainer');
  const unorderedWrapper = document.getElementById('unorderedWrapper_Add');

  if (mode === 'exist') {
    // 複数小問ありの場合
    if (singleCont) singleCont.style.display = 'none';
    if (multiCont) multiCont.style.display = 'block';
    // 💡 【追加】化学タグに関係なく、小問ありなら順不同ボタンを表示する
    if (unorderedWrapper) unorderedWrapper.style.display = 'flex'; 
    
    // 小問が1つもなければ初期枠を1つ追加する処理などが既存にあればここに続く
    const container = document.getElementById('subItemsContainer_Add');
    if (container && container.children.length === 0) {
      addSubItemField('subItemsContainer_Add');
    }
  } else {
    // 1問1答（小問なし）の場合
    if (singleCont) singleCont.style.display = 'block';
    if (multiCont) multiCont.style.display = 'none';
    // 💡 【追加】小問なしなら順不同ボタンは隠す
    if (unorderedWrapper) unorderedWrapper.style.display = 'none';
  }
}

async function addNewProblem() {
  const qInput = document.getElementById('newQuestion');
  const mainQ = qInput.value.trim();
  const isUnordered = document.getElementById('isUnordered_Add')?.checked || false; // 👈追加 
  const disableChem = document.getElementById('disableChem_Add')?.checked || false;

  if (!mainQ) { 
    showAlertModal("問題を入力してください。"); 
    return; 
  }

  const mode = document.querySelector('input[name="subItemMode"]:checked').value;
  let subItemsToInsert = [];

  if (mode === 'none') {
    const singleAnsInput = document.getElementById('singleAnswerInput');
    const ansText = singleAnsInput ? singleAnsInput.value.trim() : "";
    
    if (!ansText) { 
      showAlertModal("答えを入力してください。"); 
      return; 
    }
    
    subItemsToInsert.push({
      sub_question: "答え",
      answer: ansText,
      sort_order: 0
    });
  } else {
    const rows = document.querySelectorAll('#subItemsContainer_Add .sub-item-row');
    
    if (rows.length === 0) { 
      showAlertModal("最低1つ以上の小問を追加してください。"); 
      return; 
    }
    
    subItemsToInsert = Array.from(rows).map((row, index) => ({
      sub_question: row.querySelector('.sub-q-input').value.trim() || `小問${index + 1}`,
      answer: row.querySelector('.sub-a-input').value.trim(),
      sort_order: index
    }));
    
    if (subItemsToInsert.some(item => !item.answer)) {
      showAlertModal("答えが空の小問があります。");
      return;
    }
  }

  const { data: insertedWord, error: wordError } = await supabaseClient
    .from('words')
    .insert([{ room_id: currentActiveListId, question: mainQ, is_unordered: isUnordered, disable_chem_convert: disableChem }])    .select()
    .single();

  if (wordError) {
    showAlertModal("問題の登録に失敗しました: " + wordError.message);
    return;
  }

  const finalSubItems = subItemsToInsert.map(sub => ({
    word_id: insertedWord.id,
    sub_question: sub.sub_question,
    answer: sub.answer,
    sort_order: sub.sort_order
  }));

  const { error: subError } = await supabaseClient
    .from('sub_items') 
    .insert(finalSubItems);

  if (subError) {
    showAlertModal("小問の登録に失敗しました: " + subError.message);
    return;
  }

  qInput.value = "";
  const singleAnsInput = document.getElementById('singleAnswerInput');
  if (singleAnsInput) singleAnsInput.value = "";
  
  const subContainer = document.getElementById('subItemsContainer_Add');
  if (subContainer) subContainer.innerHTML = "";

  await loadAllAppDataFromSupabase();
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (foundList) quizData = foundList.items || [];
  
  renderMainList();
  qInput.focus();
}

async function triggerEditWordModal(id) {
  const targetItem = quizData.find(item => String(item.id) === String(id));
  if (!targetItem) return;

  // 問題文をセット
  document.getElementById('modalEditQ').value = targetItem.question;
  
  // 小問コンテナをクリアして再描画
  const container = document.getElementById('subItemsContainer_Edit');
  container.innerHTML = ""; 

  if (targetItem.sub_items) {
    targetItem.sub_items.forEach(sub => {
      if (typeof addSubItemField === 'function') {
        addSubItemField('subItemsContainer_Edit', sub.sub_question, sub.answer);
      }
    });
  }

  // 💡 【修正】HTML側の順不同チェックボックスに現在の設定（true/false）を反映
  if (document.getElementById('isUnordered_Edit')) {
    document.getElementById('isUnordered_Edit').checked = targetItem.is_unordered || false;
  }

  if (document.getElementById('disableChem_Edit')) {
    document.getElementById('disableChem_Edit').checked = targetItem.disable_chem_convert || false;
  }

  // モーダルを開く
  openModal('editWordModal');

  // 保存ボタンが押された時の処理
  document.getElementById('modalConfirmEditBtn').onclick = async () => {
    // 💡 HTML側のチェックボックスから状態を取得
    const isUnorderedEdit = document.getElementById('isUnordered_Edit')?.checked || false;
    const newMainQ = document.getElementById('modalEditQ').value.trim();
    const disableChemEdit = document.getElementById('disableChem_Edit')?.checked || false; // 💡 追加
    const rows = document.querySelectorAll('#subItemsContainer_Edit .sub-item-row');
    
    if (!newMainQ) {
      showAlertModal("問題を入力してください。");
      return;
    }
    if (rows.length === 0) { 
      showAlertModal("小問を1つ以上登録してください。"); 
      return; 
    }

    // 💡 wordsテーブルの更新（is_unordered も一緒に保存）
    const { error: pError } = await supabaseClient
      .from('words')
      .update({ question: newMainQ, is_unordered: isUnorderedEdit, disable_chem_convert: disableChemEdit })
      .eq('id', id);

    if (pError) { showAlertModal("更新に失敗しました"); return; }

    // 既存の小問を一旦すべて削除
    await supabaseClient.from('sub_items').delete().eq('word_id', id);

    // 新しい小問データの組み立て
    const subItemsToInsert = Array.from(rows).map((row, index) => ({
      word_id: id,
      sub_question: row.querySelector('.sub-q-input').value.trim() || `小問${index + 1}`,
      answer: row.querySelector('.sub-a-input').value.trim(),
      sort_order: index
    }));

    // 小問のインサート
    const { error: cError } = await supabaseClient
      .from('sub_items')
      .insert(subItemsToInsert);

    if (cError) { showAlertModal("小問の更新に失敗しました"); return; }

    // モーダルを閉じて画面をリロード
    closeModal('editWordModal');

    await loadAllAppDataFromSupabase();
    const foundList = appData.find(l => l.listId === currentActiveListId);
    if (foundList) quizData = foundList.items || [];
    
    renderMainList();
    saveViewState();
  };
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

  const isReverse = document.getElementById('dirReverse') && document.getElementById('dirReverse').checked;
  if (isReverse) {
    filtered = filtered.map(item => {
      const subItems = item.sub_items || [];
      const combinedAnswers = subItems.map(s => s.answer).join('、 ');
      return {
        id: item.id, 
        room_id: item.room_id,
        question: combinedAnswers, 
        sub_items: subItems.map((s, idx) => ({
          id: s.id,
          word_id: s.word_id,
          sub_question: `問題${idx + 1}`,
          answer: item.question, 
          sort_order: s.sort_order
        }))
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
  
  const wrapper = document.getElementById('chemInputWrapper');
  if (!wrapper) return;
  wrapper.innerHTML = ""; 

  let currentQ = currentQuestions[currentIndex]; 
  if (progressText) progressText.textContent = `第 ${currentIndex + 1} 問 / 全 ${currentQuestions.length} 問`;

  if (document.getElementById('quizBigCardQuestion')) {
    document.getElementById('quizBigCardQuestion').textContent = currentQ.question;
  }

  const subItems = currentQ.sub_items || [];

  if (subItems.length > 0) {
    subItems.forEach((item, index) => {
      const subContainer = document.createElement('div');
      subContainer.style.cssText = 'margin-bottom: 15px; text-align: left; width: 100%;';
      
      const numLabel = CIRCLE_NUMBERS[index] || `(${index + 1})`;
      const label = document.createElement('div');
      label.textContent = `${numLabel} ${item.sub_question}`;
      label.style.cssText = 'font-size: 0.95rem; color: #444; margin-bottom: 6px; font-weight: bold;';
      
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'chem-input-field sub-chem-input';
      input.id = `chemInput_${index}`;
      input.dataset.correctAnswer = item.answer; 
      input.placeholder = "答えを入力";
      input.style.cssText = 'width: 100%; padding: 10px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px;';
      
      if (typeof initInputFieldAutoConversion === 'function') {
        initInputFieldAutoConversion(input);
      }

      subContainer.appendChild(label);
      subContainer.appendChild(input);
      wrapper.appendChild(subContainer);
    });
    
    setTimeout(() => document.getElementById('chemInput_0')?.focus(), 50);

  } else {
    const div = document.createElement('div');
    div.textContent = "※小問が登録されていません。";
    div.style.color = "#999";
    wrapper.appendChild(div);
  }
  
  const submitBtn = document.getElementById('submitBtn');
  const resetBtn = document.getElementById('resetBtn');
  if (submitBtn) submitBtn.disabled = false;
  if (resetBtn) resetBtn.disabled = false;

  if (previousAnswerArea) {
    if (lastResultFeedbackHTML) {
      previousAnswerArea.innerHTML = lastResultFeedbackHTML;
    } else {
      previousAnswerArea.innerHTML = "";
    }
  }
}

function resetQuizInput() {
  const subInputs = document.querySelectorAll('.sub-chem-input');
  subInputs.forEach(input => input.value = "");
  document.getElementById('chemInput_0')?.focus();
}

function checkAnswer() {
  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn && submitBtn.disabled) return;

  let currentQ = currentQuestions[currentIndex]; 
  
  function simplify(t) { 
    return t.replaceAll('+','').replaceAll('⁺','').replaceAll('→','').replaceAll('->','').replaceAll(' ','').trim(); 
  }
  
  let isAllCorrect = true;
  let logDetails = [];

  const subInputs = document.querySelectorAll('.sub-chem-input');

  // 💡 【修正】順不同フラグが true の場合のロジック
  if (currentQ.is_unordered) {
    // ユーザーの入力一覧と、正解の一覧を配列として取得
    let userAnswers = Array.from(subInputs).map(input => input.value.trim());
    let correctAnswers = Array.from(subInputs).map(input => input.dataset.correctAnswer || "");

    // 判定用に「簡略化（スペースや矢印を削除）した正解のリスト」を作る
    let simplifiedCorrectList = correctAnswers.map(simplify);

    subInputs.forEach((input, idx) => {
      let userAns = input.value.trim();
      let simplifiedUser = simplify(userAns);
      input.disabled = true;

      // ログ用には元の入力と本来の枠の正解を一旦ペアにしておく
      logDetails.push({ user: userAns, correct: correctAnswers[idx] });

      // 空欄ではなく、かつ簡略化した正解リストのどこかに一致するか探す
      const matchIndex = simplifiedCorrectList.indexOf(simplifiedUser);

      if (simplifiedUser !== "" && matchIndex !== -1) {
        // 一致するものがあった（順不同での正解）
        input.style.backgroundColor = '#e8f5e9'; 
        input.style.borderColor = '#66bb6a';
        // 💡 同じ答えを2回書いて正解になるのを防ぐため、マッチした正解はリストから除外
        simplifiedCorrectList.splice(matchIndex, 1);
      } else {
        // どこにも一致しなかった（不正解）
        isAllCorrect = false;
        input.style.backgroundColor = '#ffebee'; 
        input.style.borderColor = '#ef5350';
      }
    });

  } else {
    // 💡 通常モード（従来の順番通りに判定するロジック）
    subInputs.forEach((input) => {
      let userAns = input.value.trim();
      let srcAns = input.dataset.correctAnswer || "";
      
      input.disabled = true; 

      logDetails.push({ user: userAns, correct: srcAns });

      if (simplify(userAns) !== simplify(srcAns)) {
        isAllCorrect = false;
        input.style.backgroundColor = '#ffebee'; 
        input.style.borderColor = '#ef5350';
      } else {
        input.style.backgroundColor = '#e8f5e9'; 
        input.style.borderColor = '#66bb6a';
      }
    });
  }

  // --- 📝 ここから下の履歴保存や苦手登録、0.1秒タイマーのロジックはそのまま維持 ---
  const logUserStr = logDetails.map(d => d.user || "（未入力）").join('、 ');
  const logCorrectStr = logDetails.map(d => d.correct).join('、 ');

  quizHistoryLogs.push({ 
    question: currentQ.question, 
    correctAnswer: logCorrectStr, 
    userAns: logUserStr, 
    isCorrect: isAllCorrect 
  });

  if (submitBtn) submitBtn.disabled = true;  
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.disabled = true;

  const qIdStr = String(currentQ.id);
  let wrongIds = getSavedWrongIds();

  if (isAllCorrect) {
    lastResultFeedbackHTML = `前問: <span class="prev-correct">⭕ 全問正解！</span> 【${currentQ.question}】`;
    wrongIds = wrongIds.filter(id => String(id) !== qIdStr);
  } else {
    lastResultFeedbackHTML = `前問: <span class="prev-wrong">❌ 不正解あり</span> 【${currentQ.question}】 <br><small style="color:#555;">正解: ${logCorrectStr}</small>`;
    wrongQuestions.push(currentQ);
    if (!wrongIds.includes(qIdStr)) {
      wrongIds.push(qIdStr);
    }
  }
  
  saveWrongIds(wrongIds); 
  saveViewState();
  
  autoNextTimer = setTimeout(() => {
    nextQuestion();
  }, 100); // ⚡ 爆速0.1秒移動もバッチリ維持しています
}

function nextQuestion() {
  currentIndex++;
  if (currentIndex < currentQuestions.length) { 
    saveViewState();
    showQuestion(); 
  } else { 
    saveViewState();
    navigateTo('#result'); 
    routeView('#result');
  }
}

function showQuizReviewSummary() {
  const wrongCount = quizHistoryLogs.filter(l => !l.isCorrect).length;
  const retryWrongBtn = document.getElementById('retryWrongBtn');
  if (retryWrongBtn) {
    retryWrongBtn.style.display = wrongCount > 0 ? "inline-block" : "none";
  }
  if (document.getElementById('quizFinalScore')) {
    document.getElementById('quizFinalScore').textContent = `🏁 テスト終了！ 正解数: ${quizHistoryLogs.filter(l => l.isCorrect).length} / ${quizHistoryLogs.length}`;
  }
  switchReviewTab('all'); 
}

function switchReviewTab(tabType) {
  const tabAll = document.getElementById('tabAllBtn');
  const tabWrong = document.getElementById('tabWrongBtn');
  if (tabType === 'all') {
    if (tabAll) tabAll.className = "btn btn-action"; 
    if (tabWrong) tabWrong.className = "btn btn-sub";
    renderReviewRows(quizHistoryLogs);
  } else {
    if (tabAll) tabAll.className = "btn btn-sub"; 
    if (tabWrong) tabWrong.className = "btn btn-action";
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

function startMemorizeMode() {
  if (!prepareQuestions()) return;
  memoIndex = 0;
  saveViewState();
  navigateTo('#memorize');
  routeView('#memorize');
}

function showMemoCard() {
  isCardFront = true;
  const card = document.getElementById('bigCard');
  if(!card || !currentQuestions[memoIndex]) return;
  card.classList.remove('back-style');
  if (document.getElementById('memoProgress')) {
    document.getElementById('memoProgress').textContent = `暗記カード： ${memoIndex + 1} / ${currentQuestions.length}`;
  }

  const currentQ = currentQuestions[memoIndex];
  const subItems = currentQ.sub_items || [];
  const isReverse = document.getElementById('dirReverse') && document.getElementById('dirReverse').checked;

  if (isReverse) {
    card.textContent = currentQ.question;
  } else if (subItems.length > 0) {
    let qHTML = `<div style="text-align: center; width: 100%;">`;
    qHTML += `<div style="font-size: 1.6rem; font-weight: bold; margin-bottom: 20px; word-break: break-all;">${currentQ.question}</div>`;
    subItems.forEach((sub, idx) => {
      const numLabel = CIRCLE_NUMBERS[idx] || `(${idx + 1})`;
      qHTML += `<div style="font-size: 1.2rem; color: #444; margin-bottom: 10px; line-height: 1.4;">${numLabel} ${sub.sub_question}</div>`;
    });
    qHTML += `</div>`;
    card.innerHTML = qHTML;
  } else {
    card.textContent = currentQ.question;
  }

  const prevWrapper = document.getElementById('memoPrevBtnWrapper');
  if(prevWrapper) {
    prevWrapper.style.visibility = (memoIndex === 0) ? "hidden" : "visible";
  }
}

function flipBigCard() {
  const card = document.getElementById('bigCard');
  if (!card || !currentQuestions[memoIndex]) return;

  const currentQ = currentQuestions[memoIndex];
  const subItems = currentQ.sub_items || [];
  const isReverse = document.getElementById('dirReverse') && document.getElementById('dirReverse').checked;

  if (isFrontView()) {
    if (isReverse) {
      if (subItems.length > 0) card.textContent = subItems[0].answer;
    } else if (subItems.length > 0) {
      let aHTML = `<div style="text-align: center; width: 100%;">`;
      subItems.forEach((sub, idx) => {
        const numLabel = CIRCLE_NUMBERS[idx] || `(${idx + 1})`;
        aHTML += `<div style="font-size: 1.4rem; font-weight: bold; color: #2196f3; margin-bottom: 12px;">${numLabel} ${sub.answer}</div>`;
      });
      aHTML += `</div>`;
      card.innerHTML = aHTML;
    } else {
      card.textContent = "（答えが登録されていません）";
    }
    card.classList.add('back-style');
  } else {
    if (isReverse) {
      card.textContent = currentQ.question;
    } else if (subItems.length > 0) {
      let qHTML = `<div style="text-align: center; width: 100%;">`;
      qHTML += `<div style="font-size: 1.6rem; font-weight: bold; margin-bottom: 20px; word-break: break-all;">${currentQ.question}</div>`;
      subItems.forEach((sub, idx) => {
        const numLabel = CIRCLE_NUMBERS[idx] || `(${idx + 1})`;
        qHTML += `<div style="font-size: 1.2rem; color: #444; margin-bottom: 10px; line-height: 1.4;">${numLabel} ${sub.sub_question}</div>`;
      });
      qHTML += `</div>`;
      card.innerHTML = qHTML;
    } else {
      card.textContent = currentQ.question;
    }
    card.classList.remove('back-style');
  }
  
  toggleCardState();
  saveViewState();
}

function isFrontView() {
  return typeof isCardFront !== 'undefined' ? isCardFront : !document.getElementById('bigCard').classList.contains('back-style');
}
function toggleCardState() {
  if (typeof isCardFront !== 'undefined') {
    isCardFront = !isCardFront;
  }
}

function nextMemo() {
  if (memoIndex < currentQuestions.length - 1) { 
    memoIndex++; 
    showMemoCard(); 
    saveViewState(); 
  } else { 
    openModal('memoEndModal'); 
  }
}

function restartMemorize() {
  closeModal('memoEndModal');
  memoIndex = 0;
  showMemoCard();
  saveViewState();
}

function exitMemorize() {
  closeModal('memoEndModal');
  backToMainList();
}

function prevMemo() { 
  if (memoIndex > 0) { 
    memoIndex--; 
    showMemoCard(); 
    saveViewState(); 
  } 
}

function backToMainList() {
  if (autoNextTimer) clearTimeout(autoNextTimer); 
  navigateTo('#list');
  routeView('#list');
}

function startQuizMode() {
  if (!prepareQuestions()) return;
  currentIndex = 0;
  quizHistoryLogs = []; 
  saveViewState();
  navigateTo('#quiz');
  routeView('#quiz');
}

function retryQuiz(retryMode) {
  if (autoNextTimer) clearTimeout(autoNextTimer);
  
  if (retryMode === 'wrong') {
    const wrongItems = [];
    quizHistoryLogs.forEach(log => {
      if (!log.isCorrect) {
        const match = quizData.find(item => item.question === log.question);
        if (match) {
          wrongItems.push(match);
        }
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

function getSavedWrongIds() { 
  if (!currentActiveListId) return [];
  const rawData = localStorage.getItem(`chem_wrong_ids_${currentActiveListId}`);
  return rawData ? JSON.parse(rawData).map(id => String(id)) : []; 
}

function saveWrongIds(ids) { 
  if (!currentActiveListId) return;
  const uniqueIds = Array.from(new Set(ids.map(id => String(id))));
  localStorage.setItem(`chem_wrong_ids_${currentActiveListId}`, JSON.stringify(uniqueIds)); 
  updateWrongCountLabel(); 
}

function updateWrongCountLabel() { 
  const lbl = document.getElementById('wrongCountLabel'); 
  if (!lbl) return;

  if (!currentActiveListId) {
    lbl.textContent = "0";
    return;
  }

  const savedWrongIds = getSavedWrongIds();
  const list = appData.find(l => String(l.listId) === String(currentActiveListId));
  const realItems = (list && list.items) ? list.items : [];
  const validWrongIds = savedWrongIds.filter(id => 
    realItems.some(item => String(item.id) === String(id))
  );

  lbl.textContent = validWrongIds.length; 
}

function hasChemTag() {
  if (!currentActiveListId) return false;
  const currentList = appData.find(l => l.listId === currentActiveListId);
  if (!currentList || !currentList.listTags) return false;
  
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

    const isDisableAdd = document.getElementById('disableChem_Add')?.checked;
    const isDisableEdit = document.getElementById('disableChem_Edit')?.checked;
    if (isDisableAdd || isDisableEdit) {
      return; // 自動変換ロジックを通さずに、ここで処理を終了する
    }

    let start = targetInput.selectionStart; 
    let val = targetInput.value;
    
    const revertMap = {
      '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9',
      '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'
    };
    val = val.split('').map(c => revertMap[c] || c).join('');

    val = val.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    val = val.replaceAll('；', ';').replaceAll('ー', '-').replaceAll('．', '.').replaceAll(' ”', '"').replaceAll(' ', ' ');
    val = val.replaceAll('＋', '+');

    const shiftNumbers = { '!': '1', '"': '2', '#': '3', '$': '4', '%': '5', '&': '6', "'": '7' };
    for (let key in shiftNumbers) { val = val.replaceAll(key, shiftNumbers[key]); }
    
    val = val.replaceAll(';', '⁺');
    val = val.replaceAll('-', '⁻');
    val = val.replaceAll('.', '･').replaceAll(' ', '→');
    val = val.toUpperCase();
    
    val = val.replaceAll('E-', 'e-');
    val = val.replaceAll('E⁺', 'e⁺');

    const elements2char = ['He','Li','Be','Ne','Na','Mg','Al','Si','Cl','Ar','K','Ca','Sc','Ti','V','Cr','Mn','Fe','Ni','Cu','Zn','Ga','Ge','As','Se','Br','Kr','Rb','Sr','Y','Zr','Nb','Mo','Tc','Ru','Rh','Pd','Ag','Cd','In','Sn','Sb','Te','I','Xe','Cs','Ba','Pt','Au','Hg','Pb','Bi','Po','At','Rn','Fr','Ra','U'];
    elements2char.forEach(el => { val = val.replaceAll(el.toUpperCase(), el); });
    
    const polyIons = [
      { reg: /HCO3([⁺⁻])/g, rep: 'HCO₃$1' },
      { reg: /NO3([⁺⁻])/g, rep: 'NO₃$1' },
      { reg: /HSO4([⁺⁻])/g, rep: 'HSO₄$1' },
      { reg: /ClO2([⁺⁻])/g, rep: 'ClO₂$1' },
      { reg: /ClO3([⁺⁻])/g, rep: 'ClO₃$1' },
      { reg: /ClO4([⁺⁻])/g, rep: 'ClO₄$1' },
      { reg: /MnO4([⁺⁻])/g, rep: 'MnO₄$1' },
      { reg: /NH4([⁺⁻])/g, rep: 'NH₄$1' } 
    ];
    polyIons.forEach(item => { val = val.replace(item.reg, item.rep); });

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

// 🌐 アプリ全体のすべての入力欄（追加・編集・小テストなど）のEnter操作を一括集中管理
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  if (e.isComposing) return; 

  const target = e.target;
  if (target.tagName !== 'INPUT') return; 

  e.preventDefault(); 

  const allInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(input => {
    return input.offsetParent !== null && !input.disabled;
  });

  const currentIndex = allInputs.indexOf(target);

  if (currentIndex !== -1 && currentIndex < allInputs.length - 1) {
    allInputs[currentIndex + 1].focus();
    return;
  }

  if (target.id === 'newListName') {
    createNewList(); 
  } 
  else if (target.closest('#subItemsContainer_Add') || target.id === 'singleAnswerInput' || target.id === 'newQuestion') {
    addNewProblem(); 
  } 
  else if (target.closest('#subItemsContainer_Edit') || target.id === 'modalEditQ' || target.id === 'modalEditListName' || target.id === 'modalEditListTags') {
    const editWordBtn = document.getElementById('modalConfirmEditBtn');
    const editListBtn = document.getElementById('modalConfirmListInfoBtn');
    
    if (editWordBtn && editWordBtn.offsetParent !== null) editWordBtn.click();
    if (editListBtn && editListBtn.offsetParent !== null) editListBtn.click();
  } 
  else if (target.classList.contains('sub-chem-input') || target.id === 'chemInput') {
    checkAnswer(); 
  }
});

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

function openEditListInfoModal() {
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (!foundList) return;

  document.getElementById('modalEditListName').value = foundList.listName;
  document.getElementById('modalEditListTags').value = foundList.listTags || "";

  openModal('editListInfoModal');

  setTimeout(() => {
    document.getElementById('modalEditListName')?.focus();
  }, 50); 

  document.getElementById('modalConfirmListInfoBtn').onclick = async () => {
    const newName = document.getElementById('modalEditListName').value.trim();
    const newTags = document.getElementById('modalEditListTags').value.trim();

    if (newName === "") {
      showAlertModal("単語帳の名前は空にできません。"); 
      return;
    }

    const { error } = await supabaseClient
      .from('rooms')
      .update({ title: newName, tags: newTags })
      .eq('id', currentActiveListId);

    if (error) { 
      showAlertModal("情報の保存に失敗しました: " + error.message); 
      return; 
    }

    foundList.listName = newName;
    foundList.listTags = newTags;
    document.getElementById('currentListTitle').textContent = newName;

    await loadAllAppDataFromSupabase();
    updateChemPlaceholder();
    saveViewState();
    routeView('#list'); 
    closeModal('editListInfoModal');
  };
}

function updateChemPlaceholder() {
  if (!currentActiveListId) return;
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (!foundList) return;

  const hasChem = foundList.listTags && foundList.listTags.split(',').map(t => t.trim()).includes('化学');
  
  // 💡 【修正】入力ヒントだけは化学タグの有無で表示/非表示を切り替える
  if (document.getElementById('hintTextAdd')) document.getElementById('hintTextAdd').style.display = hasChem ? 'block' : 'none';
  if (document.getElementById('hintTextEdit')) document.getElementById('hintTextEdit').style.display = hasChem ? 'block' : 'none';
  if (document.getElementById('disableChemWrapper_Add')) document.getElementById('disableChemWrapper_Add').style.display = hasChem ? 'flex' : 'none';
  if (document.getElementById('disableChemWrapper_Edit')) document.getElementById('disableChemWrapper_Edit').style.display = hasChem ? 'flex' : 'none';
  // 💡 編集モーダル側の順不同ボタンは、編集を開いた時点で常に表示させておく
  if (document.getElementById('unorderedWrapper_Edit')) document.getElementById('unorderedWrapper_Edit').style.display = 'flex';

  // プレースホルダーのテキスト切り替え
  const placeholderText = hasChem ? "答え（自動変換が適用されます）" : "答え";
  const newAnswerInput = document.getElementById('newAnswer');
  const modalEditAInput = document.getElementById('modalEditA');
  if (newAnswerInput) newAnswerInput.placeholder = placeholderText;
  if (modalEditAInput) modalEditAInput.placeholder = placeholderText;

  // 化学ヘルプボタンの制御
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

function showChemHelpModal() {
  let chemModal = document.getElementById('chemHelpModal');
  
  if (!chemModal) {
    chemModal = document.createElement('div');
    chemModal.id = 'chemHelpModal';
    chemModal.className = 'modal-overlay';
    chemModal.style.cssText = 'display: flex; justify-content: center; align-items: flex-start; padding-top: 5vh; overflow-y: auto;';

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

function closeChemHelpModal() {
  const chemModal = document.getElementById('chemHelpModal');
  if (chemModal) {
    chemModal.style.display = 'none';
  }
}

function showAlertModal(message) {
  const textElem = document.getElementById('alertModalText');
  if (textElem) {
    textElem.textContent = message;
    openModal('alertModal');
  } else {
    alert(message); 
  }
}

function showDeleteConfirmModal(message, onConfirm) {
  const modal = document.getElementById('deleteConfirmModal');
  const textElem = document.getElementById('deleteConfirmModalText');
  const cancelBtn = document.getElementById('deleteModalCancelBtn');
  const confirmBtn = document.getElementById('deleteModalConfirmBtn');
  
  if (!modal) {
    if (confirm(message)) onConfirm();
    return;
  }

  textElem.textContent = message;
  modal.style.display = 'flex';

  confirmBtn.onclick = function() {
    modal.style.display = 'none';
    onConfirm(); 
  };

  cancelBtn.onclick = function() {
    modal.style.display = 'none';
  };
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  let isOverlayMousedown = false;

  overlay.addEventListener('mousedown', function(e) {
    isOverlayMousedown = (e.target === this);
  });

  overlay.addEventListener('click', function(e) {
    if (e.target === this && isOverlayMousedown) {
      const modalId = this.id;
      if (modalId && typeof closeModal === 'function') {
        closeModal(modalId);
      }
    }
  });
});

function toggleCustomSettingsUI() {
  const isCustom = document.getElementById('targetCustom').checked;
  const customArea = document.getElementById('customSettingsArea');
  if (customArea) {
    customArea.style.display = isCustom ? 'block' : 'none';
  }
}

function toggleBulkDeleteMode() {
  isBulkDeleteMode = !isBulkDeleteMode;

  const triggerBtn = document.getElementById('bulkDeleteTriggerBtn');
  const executeBtn = document.getElementById('bulkExecuteBtn');
  const cancelBtn = document.getElementById('bulkCancelBtn');

  if (isBulkDeleteMode) {
    if (triggerBtn) triggerBtn.style.display = "none";
    if (executeBtn) executeBtn.style.display = "inline-block";
    if (cancelBtn) cancelBtn.style.display = "inline-block";
  } else {
    if (triggerBtn) triggerBtn.style.display = "inline-block";
    if (executeBtn) executeBtn.style.display = "none";
    if (cancelBtn) cancelBtn.style.display = "none";
  }

  renderMainList();
}

function addSubItemField(containerId, initialQ = "", initialA = "") {
  const container = document.getElementById(containerId);
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'sub-item-row';
  div.style.cssText = 'display: flex; gap: 8px; margin-bottom: 8px; align-items: center;';
  
  div.innerHTML = `
    <input type="text" class="sub-q-input" placeholder="小問（例：①触媒は？）" value="${initialQ}" style="flex: 1; padding: 6px;">
    <input type="text" class="sub-a-input" placeholder="答え（例：V2O5）" value="${initialA}" style="flex: 1; padding: 6px;">
    <button type="button" onclick="this.parentElement.remove()" style="background:none; border:none; cursor:pointer; font-size:1.2rem; color:#e53935;">🗑️</button>
  `;
  
  const aInput = div.querySelector('.sub-a-input');
  if (aInput) {
    initInputFieldAutoConversion(aInput);
  }
  
  container.appendChild(div);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.style.display = 'flex';
    modal.style.alignItems = 'flex-start'; 
    modal.style.paddingTop = '15vh';       
  }
}