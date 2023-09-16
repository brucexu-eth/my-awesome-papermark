import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { hashPassword } from "@/lib/utils";
import { authOptions } from "../../auth/[...nextauth]";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "GET") {
    // GET /api/links/:id
    const { id } = req.query as { id: string };

    try {
      const link = await prisma.link.findUnique({
        where: {
          id: id,
        },
        select: {
          id: true,
          expiresAt: true,
          emailProtected: true,
          password: true,
          document: { select: { id: true } },
        },
      });

      return res.status(200).json(link);
    } catch (error) {
      return res.status(500).json({
        message: "Internal Server Error",
        error: (error as Error).message,
      });
    }
  } 
  
  if (req.method === "PUT") {
    // PUT /api/links/:id
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { id } = req.query as { id: string };
    const { documentId, password, expiresAt, ...linkDomainData } = req.body;

    const hashedPassword =
      password && password.length > 0 ? await hashPassword(password) : null;
    const exat = expiresAt ? new Date(expiresAt) : null;

    let { domain, slug, ...linkData } = linkDomainData;

    // set domain and slug to null if the domain is papermark.io
    if (domain && domain === "papermark.io") {
      domain = null;
      slug = null;
    }

    let domainObj;

    if (domain && slug) {
      domainObj = await prisma.domain.findUnique({
        where: {
          slug: domain
        }
      }) 

      if (!domainObj) {
        return res.status(400).json({ error: "Domain not found." });
      }

      const currentLink = await prisma.link.findUnique({
        where: { id: id },
        select: {
          id: true,
          domainSlug: true,
          slug: true,
        },
      });

      // if the slug or domainSlug has changed, check if the new slug is unique
      if (currentLink?.slug !== slug || currentLink?.domainSlug !== domain) {
        const existingLink = await prisma.link.findUnique({
          where: {
            domainSlug_slug: {
              slug: slug,
              domainSlug: domain,
            },
          },
        });

        if (existingLink) {
          return res.status(400).json({
            error: "The link already exists.",
          });
        }
      }
    }

    // Update the link in the database
    const updatedLink = await prisma.link.update({
      where: { id: id },
      data: {
        documentId: documentId,
        password: hashedPassword,
        name: linkData.name || null,
        emailProtected: linkData.emailProtected,
        expiresAt: exat,
        domainId: domainObj?.id || null,
        domainSlug: domain || null,
        slug: slug || null,
      },
      include: {
        views: {
          orderBy: {
            viewedAt: "desc",
          },
        },
        _count: {
          select: { views: true },
        },
      },
    });

    if (!updatedLink) {
      return res.status(404).json({ error: "Link not found" });
    }

    return res.status(200).json(updatedLink);
  }

  // We only allow GET and PUT requests
  res.setHeader("Allow", ["GET", "PUT"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}