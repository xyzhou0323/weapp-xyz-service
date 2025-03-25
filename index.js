const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { init: initDB, Counter, getQuestionnaireWithQuestions, getQuestionnaireBaseInfo } = require("./db");

const logger = morgan("tiny");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(logger);

// 首页
app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 更新计数
app.post("/api/count", async (req, res) => {
  const { action } = req.body;
  if (action === "inc") {
    await Counter.create();
  } else if (action === "clear") {
    await Counter.destroy({
      truncate: true,
    });
  }
  res.send({
    code: 0,
    data: await Counter.count(),
  });
});

app.get("/api/health", async (req, res) => {
  res.send("I'm ok");
});

// 获取计数
app.get("/api/count", async (req, res) => {
  const result = await Counter.count();
  res.send({
    code: 0,
    data: result,
  });
});

// 小程序调用，获取微信 Open ID
app.get("/api/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  }
});

// 新增获取问卷接口
app.get('/api/questionnaire/:id', async (req, res) => {
  try {
    const questionnaireId = req.params.id;
    
    // 获取基础信息
    const questionnaire = await getQuestionnaireBaseInfo(questionnaireId);
    if (!questionnaire) {
      return res.status(404).json({ code: 404, message: '问卷不存在' });
    }

    // 获取题目和选项
    const [questions] = await getQuestionnaireWithQuestions(questionnaireId);

    console.log(questions);

    // 格式化结构
    const formatted = questions.reduce((acc, row) => {
      let question = acc.find(q => q.id === row.id);
      if (!question) {
        question = {
          id: row.id,
          question_text: row.question_text,
          question_type: row.question_type,
          sort_order: row.sort_order,
          weight: row.weight,
          options: []
        };
        acc.push(question);
      }
      question.options.push({
        id: row.option_id,
        option_text: row.option_text,
        score: row.score
      });
      return acc;
    }, []);

    res.json({
      code: 0,
      data: {
        id: questionnaireId,
        questions: formatted
      }
    });

  } catch (error) {
    console.error('获取问卷失败:', error);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

const port = process.env.PORT || 80;

async function bootstrap() {
  await initDB();
  app.listen(port, () => {
    console.log("启动成功", port);
  });
}

bootstrap();
